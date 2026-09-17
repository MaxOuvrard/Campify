import { randomUUID } from 'node:crypto'
import { DeviceRepository, NewDevice } from '../../src/domain/ports/DeviceRepository'
import { MeasurementRepository } from '../../src/domain/ports/MeasurementRepository'
import { CommandRepository } from '../../src/domain/ports/CommandRepository'
import { RoomRepository } from '../../src/domain/ports/RoomRepository'
import { UserRepository } from '../../src/domain/ports/UserRepository'
import { Device } from '../../src/domain/entities/Device'
import { Measurement, NewMeasurement } from '../../src/domain/entities/Measurement'
import { Command, CommandStatus, NewCommand } from '../../src/domain/entities/Command'
import { Room } from '../../src/domain/entities/Room'
import { User } from '../../src/domain/entities/User'

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
      createdAt: new Date()
    }
    this.devices.set(device.id, device)
    return device
  }

  async updateRoom(deviceId: string, roomId: string): Promise<Device> {
    const device = this.devices.get(deviceId)
    if (!device) throw new Error(`Device ${deviceId} not found`)
    const updated = { ...device, roomId }
    this.devices.set(deviceId, updated)
    return updated
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
      receivedAt: new Date(),
      messageId: input.messageId ?? null
    }
    this.measurements.push(measurement)
    return measurement
  }

  async findLatestByDevice(deviceId: string, type?: string): Promise<Measurement | null> {
    const matches = this.measurements.filter((m) => m.deviceId === deviceId && (!type || m.type === type))
    if (matches.length === 0) return null
    return matches.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
  }

  async findByDeviceInRange(deviceId: string, from: Date, to: Date, limit: number): Promise<Measurement[]> {
    return this.measurements
      .filter((m) => m.deviceId === deviceId && m.timestamp >= from && m.timestamp <= to)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, limit)
      .reverse()
  }

  async findLatestByDeviceGroupedByType(deviceId: string): Promise<Measurement[]> {
    const latestByType = new Map<string, Measurement>()
    for (const m of this.measurements) {
      if (m.deviceId !== deviceId) continue
      const current = latestByType.get(m.type)
      if (!current || m.timestamp > current.timestamp) latestByType.set(m.type, m)
    }
    return [...latestByType.values()]
  }

  async findLatestReceivedAt(deviceId: string): Promise<Date | null> {
    const matches = this.measurements.filter((m) => m.deviceId === deviceId)
    if (matches.length === 0) return null
    return matches.reduce((a, b) => (a.receivedAt > b.receivedAt ? a : b)).receivedAt
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

export class InMemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, Room>()

  async findAll(): Promise<Room[]> {
    return [...this.rooms.values()]
  }

  async findById(id: string): Promise<Room | null> {
    return this.rooms.get(id) ?? null
  }

  async create(name: string): Promise<Room> {
    const room: Room = { id: randomUUID(), name, createdAt: new Date() }
    this.rooms.set(room.id, room)
    return room
  }

  seed(room: Room): void {
    this.rooms.set(room.id, room)
  }
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>()

  async findByEmail(email: string): Promise<User | null> {
    return [...this.users.values()].find((u) => u.email === email) ?? null
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null
  }

  seed(user: User): void {
    this.users.set(user.id, user)
  }
}
