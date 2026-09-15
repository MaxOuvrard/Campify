import { Room } from '../entities/Room'

export interface RoomRepository {
  findAll(): Promise<Room[]>
  findById(id: string): Promise<Room | null>
  create(name: string): Promise<Room>
}
