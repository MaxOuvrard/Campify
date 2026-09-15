import { CommandRepository } from '../ports/CommandRepository'
import { DeviceRepository } from '../ports/DeviceRepository'
import { MqttPublisher } from '../ports/MqttPublisher'
import { Clock } from '../ports/Clock'
import { Command, NewCommand } from '../entities/Command'
import { NotFoundError } from '../../shared/errors'

/**
 * Point d'entrée unique du domaine pour émettre et acquitter des commandes,
 * utilisé aussi bien par l'API (émission) que par le driving MQTT
 * (acquittement reçu depuis un device).
 */
export class CommandService {
  constructor(
    private readonly commands: CommandRepository,
    private readonly devices: DeviceRepository,
    private readonly publisher: MqttPublisher,
    private readonly clock: Clock
  ) {}

  async dispatch(input: NewCommand): Promise<Command> {
    const device = await this.devices.findById(input.deviceId)
    if (device === null) {
      throw new NotFoundError(`Device ${input.deviceId} not found`)
    }

    const command = await this.commands.create(input)

    await this.publisher.publishCommand({
      commandId: command.id,
      deviceId: command.deviceId,
      type: command.type,
      payload: command.payload,
      issuedAt: this.clock.now()
    })

    await this.commands.updateStatus(command.id, 'SENT', this.clock.now())

    return command
  }

  async acknowledge(commandId: string, at: Date): Promise<void> {
    const command = await this.commands.findById(commandId)
    if (command === null) {
      throw new NotFoundError(`Command ${commandId} not found`)
    }

    await this.commands.updateStatus(commandId, 'ACKED', at)
  }
}
