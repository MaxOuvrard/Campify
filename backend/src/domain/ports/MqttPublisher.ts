export interface OutgoingCommandMessage {
  commandId: string
  deviceId: string
  type: string
  payload: Record<string, unknown> | null
  issuedAt: Date
}

export interface MqttPublisher {
  publishCommand(message: OutgoingCommandMessage): Promise<void>
}
