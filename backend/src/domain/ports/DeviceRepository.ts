import { Device } from '../entities/Device'

export interface NewDevice {
  name: string
  type: string
  roomId: string
}

export interface DeviceRepository {
  findAll(): Promise<Device[]>
  findById(id: string): Promise<Device | null>
  findByRoom(roomId: string): Promise<Device[]>
  create(input: NewDevice): Promise<Device>
}
