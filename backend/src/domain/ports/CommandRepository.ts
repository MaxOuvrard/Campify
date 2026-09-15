import { Command, CommandStatus, NewCommand } from '../entities/Command'

export interface CommandRepository {
  create(input: NewCommand): Promise<Command>
  findById(id: string): Promise<Command | null>
  updateStatus(id: string, status: CommandStatus, at: Date): Promise<void>
}
