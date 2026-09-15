import { randomUUID } from 'node:crypto'
import { DeviceRepository, NewDevice } from '../../src/domain/ports/DeviceRepository'
import { MeasurementRepository } from '../../src/domain/ports/MeasurementRepository'
import { CommandRepository } from '../../src/domain/ports/CommandRepository'
import { Device } from '../../src/domain/entities/Device'
import { Measurement, NewMeasurement } from '../../src/domain/entities/Measurement'
import { Command, CommandStatus, NewCommand } from '../../src/domain/entities/Command'

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly devices = new Map<string, Device>()

  async findAll(): Promise<Device[]> {
    return [...this.devices.values()]
  }

  async findById(id: string): Promise<Device | null> {
    return this.devices.get(id) ?? null
  }

  async findByRoom(roomId: string): Promise<Device[]> {
    return [...this.devices.values()].filter((d) => d.roomId === roomId)
  }

  async create(input: NewDevice): Promise<Device> {
    const device: Device = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      roomId: input.roomId,
      lastSeenAt: null,
      createdAt: new Date()
    }
    this.devices.set(device.id, device)
    return device
  }

  async updateLastSeen(id: string, lastSeenAt: Date): Promise<void> {
    const device = this.devices.get(id)
    if (device) device.lastSeenAt = lastSeenAt
  }

  seed(device: Device): void {
    this.devices.set(device.id, device)
  }
}

export class InMemoryMeasurementRepository implements MeasurementRepository {
  readonly measurements: Measurement[] = []

  async create(input: NewMeasurement): Promise<Measurement> {
    const measurement: Measurement = {
      id: randomUUID(),
      deviceId: input.deviceId,
      type: input.type,
      value: input.value,
      unit: input.unit ?? null,
      timestamp: input.timestamp,
      receivedAt: new Date()
    }
    this.measurements.push(measurement)
    return measurement
  }

  async findLatestByDevice(deviceId: string, type?: string): Promise<Measurement | null> {
    const matches = this.measurements.filter((m) => m.deviceId === deviceId && (!type || m.type === type))
    if (matches.length === 0) return null
    return matches.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
  }

  async findByDeviceInRange(deviceId: string, from: Date, to: Date): Promise<Measurement[]> {
    return this.measurements.filter((m) => m.deviceId === deviceId && m.timestamp >= from && m.timestamp <= to)
  }
}

export class InMemoryCommandRepository implements CommandRepository {
  private readonly commands = new Map<string, Command>()

  async create(input: NewCommand): Promise<Command> {
    const command: Command = {
      id: randomUUID(),
      deviceId: input.deviceId,
      type: input.type,
      payload: input.payload ?? null,
      status: 'PENDING',
      createdAt: new Date(),
      sentAt: null,
      ackedAt: null
    }
    this.commands.set(command.id, command)
    return command
  }

  async findById(id: string): Promise<Command | null> {
    return this.commands.get(id) ?? null
  }

  async updateStatus(id: string, status: CommandStatus, at: Date): Promise<void> {
    const command = this.commands.get(id)
    if (!command) return
    command.status = status
    if (status === 'SENT') command.sentAt = at
    if (status === 'ACKED') command.ackedAt = at
  }
}
