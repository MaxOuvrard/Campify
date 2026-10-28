import { CommandRepository } from '../ports/CommandRepository'
import { DeviceRepository } from '../ports/DeviceRepository'
import { MqttPublisher } from '../ports/MqttPublisher'
import { Clock } from '../ports/Clock'
import { Logger } from '../ports/Logger'
import { Command, CommandAck, CommandRequest, OPEN_COMMAND_STATUSES } from '../entities/Command'
import { ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors'
import { validateCommand } from './commandCatalog'

export const DEFAULT_COMMAND_ACK_TIMEOUT_MS = 15_000

export const COMMAND_EVENT_TYPE = 'command_lifecycle'

/**
 * Issue du traitement d'un ACK :
 * - `acknowledged` / `failed` : l'ACK a fait passer la commande dans son état final ;
 * - `late_ack`      : la commande était déjà en TIMEOUT — elle y reste, l'ACK est conservé à part ;
 * - `duplicate_ack` : la commande avait déjà reçu sa réponse, l'ACK n'a aucun effet.
 */
export type AckOutcome = 'acknowledged' | 'failed' | 'late_ack' | 'duplicate_ack'

export interface DispatchResult {
  command: Command
  /** `true` : rejeu d'une demande déjà reçue (même clé d'idempotence) — rien n'a été recréé ni republié. */
  replayed: boolean
}

/**
 * Point d'entrée unique du domaine pour émettre et acquitter des commandes,
 * utilisé aussi bien par l'API (émission) que par le driving MQTT
 * (acquittement reçu depuis un device). Contrat et cycle de vie : ADR 0014.
 *
 * Chaque changement d'état passe par `CommandRepository.transition()`,
 * conditionnel au statut courant : l'API, l'ingester (ACK) et le worker
 * (timeout) sont trois process distincts qui peuvent viser la même
 * commande au même instant — un seul gagne, les autres le constatent.
 */
export class CommandService {
  constructor(
    private readonly commands: CommandRepository,
    private readonly devices: DeviceRepository,
    private readonly publisher: MqttPublisher,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly ackTimeoutMs: number = DEFAULT_COMMAND_ACK_TIMEOUT_MS
  ) {}

  /**
   * Idempotent par (requestedBy, idempotencyKey) : un rejeu de la même
   * demande (double appui, retry réseau après réponse perdue) renvoie la
   * commande existante dans son état courant, sans la republier — une
   * seule exécution possible. Même clé pour une demande différente :
   * ConflictError (erreur du client). Voir ADR 0014.
   */
  async dispatch(request: CommandRequest): Promise<DispatchResult> {
    const params = validateCommand(request.type, request.params)

    const device = await this.devices.findById(request.deviceId)
    if (device === null) {
      throw new NotFoundError(`Device ${request.deviceId} not found`)
    }

    const expiresAt = new Date(this.clock.now().getTime() + this.ackTimeoutMs)
    const { command, created } = await this.commands.createIfAbsent({
      deviceId: device.id,
      type: request.type,
      params,
      expiresAt,
      requestedBy: request.requestedBy,
      idempotencyKey: request.idempotencyKey
    })

    if (!created) {
      if (command.deviceId !== device.id || command.type !== request.type || !sameParams(command.params, params)) {
        throw new ConflictError(`Idempotency-Key ${request.idempotencyKey} was already used for a different command`)
      }
      this.logger.warn('duplicate command request, existing command returned', {
        eventType: COMMAND_EVENT_TYPE,
        commandId: command.id,
        deviceId: command.deviceId,
        commandType: command.type,
        status: command.status,
        reason: 'duplicate_request',
        idempotencyKey: request.idempotencyKey
      })
      return { command, replayed: true }
    }

    const logMeta = { eventType: COMMAND_EVENT_TYPE, commandId: command.id, deviceId: command.deviceId, commandType: command.type }
    this.logger.info('command accepted', {
      ...logMeta,
      status: 'PENDING',
      expiresAt: expiresAt.toISOString(),
      requestedBy: request.requestedBy,
      idempotencyKey: request.idempotencyKey
    })

    const outcome = await this.publisher.publishCommand({
      commandId: command.id,
      deviceId: command.deviceId,
      type: command.type,
      params: command.params,
      createdAt: command.createdAt,
      expiresAt: command.expiresAt
    })

    if (outcome === 'confirmed') {
      // Peut échouer si l'ACK de l'objet est arrivé avant même ce point
      // (commande déjà ACKNOWLEDGED) : on ne revient surtout pas en arrière.
      const moved = await this.commands.transition(command.id, ['PENDING'], { status: 'SENT', sentAt: this.clock.now() })
      this.logger.info('command published', { ...logMeta, status: 'SENT', transitionApplied: moved })
    } else if (outcome === 'not_sent') {
      await this.commands.transition(command.id, ['PENDING'], { status: 'FAILED', failureReason: 'broker_unavailable' })
      this.logger.warn('command not published', { ...logMeta, status: 'FAILED', reason: 'broker_unavailable' })
    } else {
      // Publication tentée sans confirmation : elle a pu partir (ou partira
      // à la reconnexion). On ne sait pas — la commande reste PENDING, un
      // ACK peut encore la conclure, sinon le timeout le fera.
      this.logger.warn('command publish unconfirmed', { ...logMeta, status: 'PENDING', reason: 'publish_unconfirmed' })
    }

    return { command: (await this.commands.findById(command.id)) ?? command, replayed: false }
  }

  async acknowledge(ack: CommandAck): Promise<AckOutcome> {
    const command = await this.commands.findById(ack.commandId)
    if (command === null) {
      throw new NotFoundError(`Command ${ack.commandId} not found`)
    }
    // Le topic fait foi (ADR 0008) : un objet ne peut acquitter que ses
    // propres commandes, même s'il connaît le command_id d'un autre.
    if (command.deviceId !== ack.deviceId) {
      throw new ForbiddenError(`Command ${ack.commandId} does not belong to device ${ack.deviceId}`)
    }

    const logMeta = { eventType: COMMAND_EVENT_TYPE, commandId: command.id, deviceId: command.deviceId, ackStatus: ack.status }

    const moved =
      ack.status === 'executed'
        ? await this.commands.transition(command.id, OPEN_COMMAND_STATUSES, {
            status: 'ACKNOWLEDGED',
            ackedAt: ack.ackedAt,
            reportedState: ack.state
          })
        : await this.commands.transition(command.id, OPEN_COMMAND_STATUSES, {
            status: 'FAILED',
            ackedAt: ack.ackedAt,
            failureReason: ack.status === 'expired' ? 'expired_on_device' : `rejected_by_device${ack.reason ? `: ${ack.reason}` : ''}`,
            reportedState: ack.state
          })

    if (moved) {
      const status = ack.status === 'executed' ? 'ACKNOWLEDGED' : 'FAILED'
      this.logger.info('command acknowledged by device', {
        ...logMeta,
        status,
        reason: ack.reason ?? undefined,
        // De la création à la réception de l'ACK par le backend : sert à
        // calibrer COMMAND_ACK_TIMEOUT_MS sur des mesures réelles.
        latencyMs: this.clock.now().getTime() - command.createdAt.getTime()
      })
      return ack.status === 'executed' ? 'acknowledged' : 'failed'
    }

    // La commande n'était plus ouverte : relire l'état réel qui a gagné.
    const current = (await this.commands.findById(command.id)) ?? command
    if (current.status === 'TIMEOUT' && (await this.commands.recordLateAck(command.id, { status: ack.status, at: ack.ackedAt }, ack.state))) {
      this.logger.warn('late ack after timeout', { ...logMeta, status: 'TIMEOUT', reason: 'late_ack' })
      return 'late_ack'
    }

    this.logger.warn('duplicate ack ignored', { ...logMeta, status: current.status, reason: 'duplicate_ack' })
    return 'duplicate_ack'
  }
}

/** Égalité structurelle indépendante de l'ordre des clés (jsonb ne le conserve pas). */
function sameParams(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const canonical = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
  return canonical(a) === canonical(b)
}
