export type CommandStatus = 'PENDING' | 'SENT' | 'ACKED' | 'FAILED'

export interface Command {
  id: string
  deviceId: string
  type: string
  payload: Record<string, unknown> | null
  status: CommandStatus
  createdAt: Date
  sentAt: Date | null
  ackedAt: Date | null
}

export interface NewCommand {
  deviceId: string
  type: string
  payload?: Record<string, unknown> | null
}
