import { DeviceRepository } from '../ports/DeviceRepository'
import { RoomRepository } from '../ports/RoomRepository'
import { Device } from '../entities/Device'
import { NotFoundError, ValidationError } from '../../shared/errors'

// Format des QR codes du kit : `campus-device:v1:{deviceId}`. Le QR ne
// contient que l'identifiant public — il ne confère aucun droit, toute
// vérification (existence, rôle, réaffectation) reste du ressort du
// backend. Voir docs/decisions (association par QR).
const DEVICE_IDENTIFIER_PATTERN = /^campus-device:v1:(.+)$/

export function parseDeviceIdentifier(raw: string): string | null {
  const match = DEVICE_IDENTIFIER_PATTERN.exec(raw.trim())
  return match ? match[1] : null
}

/**
 * Point d'entrée unique du domaine pour associer un équipement scanné à une
 * salle. Un device peut être réaffecté librement d'une salle à une autre :
 * la dernière association gagnante fait foi, aucun historique n'est
 * conservé (pas de besoin métier identifié pour le moment).
 */
export class DeviceAssociationService {
  constructor(
    private readonly devices: DeviceRepository,
    private readonly rooms: RoomRepository
  ) {}

  async associate(scannedIdentifier: string, roomId: string): Promise<Device> {
    const deviceId = parseDeviceIdentifier(scannedIdentifier)
    if (deviceId === null) {
      throw new ValidationError(`Format de code invalide : "${scannedIdentifier}"`)
    }

    const device = await this.devices.findById(deviceId)
    if (device === null) {
      throw new NotFoundError(`Aucun équipement pour l'identifiant ${deviceId}`)
    }

    const room = await this.rooms.findById(roomId)
    if (room === null) {
      throw new NotFoundError(`Salle ${roomId} introuvable`)
    }

    return this.devices.updateRoom(device.id, roomId)
  }
}
