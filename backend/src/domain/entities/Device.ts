export interface Device {
  id: string
  name: string
  // Type libre (ex: "temperature", "humidity", "motion") : dépend du contrat
  // du kit IoT, pas encore figé. Voir docs/decisions/0004-contrat-mqtt-placeholder.md
  type: string
  roomId: string
  lastSeenAt: Date | null
  createdAt: Date
}
