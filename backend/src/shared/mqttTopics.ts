/**
 * Conventions de topics MQTT. PLACEHOLDER en attendant le contrat exact du
 * kit IoT (topics, forme des payloads) : voir
 * docs/decisions/0004-contrat-mqtt-placeholder.md. À ajuster une fois le
 * contrat connu, sans changer la manière dont le domaine consomme les
 * mesures/acquittements.
 */
export interface MqttTopics {
  measurementFilter: string
  commandAckFilter: string
  commandTopic: (deviceId: string) => string
  parseDeviceIdFromMeasurementTopic: (topic: string) => string | null
  parseDeviceIdFromAckTopic: (topic: string) => string | null
}

export function createMqttTopics(prefix: string): MqttTopics {
  return {
    measurementFilter: `${prefix}/rooms/+/devices/+/measurements`,
    commandAckFilter: `${prefix}/devices/+/commands/ack`,
    commandTopic: (deviceId: string) => `${prefix}/devices/${deviceId}/commands`,
    parseDeviceIdFromMeasurementTopic: (topic: string) => extractSegmentAfter(topic, 'devices'),
    parseDeviceIdFromAckTopic: (topic: string) => extractSegmentAfter(topic, 'devices')
  }
}

export function matchesTopic(filter: string, topic: string): boolean {
  const filterParts = filter.split('/')
  const topicParts = topic.split('/')
  if (filterParts.length !== topicParts.length) return false
  return filterParts.every((part, i) => part === '+' || part === topicParts[i])
}

function extractSegmentAfter(topic: string, marker: string): string | null {
  const parts = topic.split('/')
  const index = parts.indexOf(marker)
  if (index === -1 || !parts[index + 1]) return null
  return parts[index + 1]
}
