/**
 * Logique « objet » du contrat de commande J4 (ADR 0014), isolée du
 * transport MQTT pour être testable (test/scripts/deviceCommandHandler.test.ts).
 * C'est ce que tout firmware réel devra reproduire :
 *
 * 1. commande illisible / hors contrat → ignorée (pas de command_id fiable
 *    à qui répondre) ;
 * 2. command_id déjà traité → NE PAS réexécuter, renvoyer le MÊME ACK
 *    (redélivrance QoS 1 : c'est peut-être l'ACK qui s'était perdu) ;
 * 3. reçue après expires_at → NE PAS exécuter, répondre `expired` ;
 * 4. sinon exécuter (changer l'état), PUIS répondre `executed` avec l'état
 *    résultant — ou `rejected` si la commande est inconnue/invalide.
 *
 * La mémoire des command_id traités est bornée par expires_at : passé
 * l'échéance (+ marge), un doublon serait de toute façon `expired`.
 */
import { z } from 'zod'

export interface DeviceState {
  ventilation: 'on' | 'off'
  target_temperature: number | null
}

export type CommandMode = 'normal' | 'silent' | 'reject'

const incomingCommandSchema = z.object({
  schema_version: z.number(),
  command_id: z.string().min(1),
  device_id: z.string().min(1),
  type: z.string().min(1),
  params: z.record(z.unknown()),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime()
})

export type IncomingCommand = z.infer<typeof incomingCommandSchema>

export interface AckMessage {
  schema_version: 1
  command_id: string
  status: 'executed' | 'rejected' | 'expired'
  reason: string | null
  state: DeviceState
  acked_at: string
}

export type HandleResult =
  | { kind: 'invalid'; reason: string }
  | { kind: 'ignored'; command: IncomingCommand }
  | { kind: 'duplicate'; command: IncomingCommand; ack: AckMessage }
  | { kind: 'expired' | 'executed' | 'rejected'; command: IncomingCommand; ack: AckMessage }

/** Marge de rétention des command_id traités au-delà de leur expires_at. */
const MEMORY_MARGIN_MS = 60_000

export class DeviceCommandHandler {
  private readonly processed = new Map<string, { ack: AckMessage; expiresAt: number }>()

  constructor(
    readonly state: DeviceState,
    private readonly mode: CommandMode = 'normal',
    private readonly now: () => Date = () => new Date()
  ) {}

  handle(payload: string): HandleResult {
    this.forgetExpired()

    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      return { kind: 'invalid', reason: 'invalid_json' }
    }
    const parsed = incomingCommandSchema.safeParse(json)
    if (!parsed.success) return { kind: 'invalid', reason: 'invalid_schema' }
    const command = parsed.data

    const already = this.processed.get(command.command_id)
    if (already) return { kind: 'duplicate', command, ack: already.ack }

    if (this.mode === 'silent') return { kind: 'ignored', command }

    const expiresAt = new Date(command.expires_at).getTime()
    if (this.now().getTime() > expiresAt) {
      return this.remember(command, this.buildAck(command, 'expired', 'received_after_expires_at'))
    }

    if (this.mode === 'reject') {
      return this.remember(command, this.buildAck(command, 'rejected', 'simulated_rejection'))
    }

    const error = this.execute(command)
    return this.remember(command, error ? this.buildAck(command, 'rejected', error) : this.buildAck(command, 'executed', null))
  }

  /** Applique la commande à l'état ; renvoie un motif de refus, ou null si exécutée. */
  private execute(command: IncomingCommand): string | null {
    switch (command.type) {
      case 'set_ventilation':
        if (typeof command.params.on !== 'boolean') return 'invalid_params'
        this.state.ventilation = command.params.on ? 'on' : 'off'
        return null
      case 'set_target_temperature':
        if (typeof command.params.value !== 'number') return 'invalid_params'
        this.state.target_temperature = command.params.value
        return null
      default:
        return 'unsupported_command'
    }
  }

  private buildAck(command: IncomingCommand, status: AckMessage['status'], reason: string | null): AckMessage {
    return {
      schema_version: 1,
      command_id: command.command_id,
      status,
      reason,
      state: { ...this.state },
      acked_at: this.now().toISOString()
    }
  }

  private remember(command: IncomingCommand, ack: AckMessage): HandleResult {
    this.processed.set(command.command_id, { ack, expiresAt: new Date(command.expires_at).getTime() })
    return { kind: ack.status, command, ack }
  }

  private forgetExpired(): void {
    const limit = this.now().getTime() - MEMORY_MARGIN_MS
    for (const [id, entry] of this.processed) {
      if (entry.expiresAt < limit) this.processed.delete(id)
    }
  }
}
