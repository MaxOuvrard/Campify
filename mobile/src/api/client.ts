import { Platform } from 'react-native'

// L'émulateur Android ne peut pas joindre le host via `localhost` (il a son
// propre réseau virtuel) : `10.0.2.2` est l'adresse conventionnelle qui
// pointe vers la machine hôte. Sur un device physique, définir
// EXPO_PUBLIC_API_URL vers l'IP LAN du backend (voir mobile/.env.example).
const DEFAULT_API_URL = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000'

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function login(email: string, password: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
  } catch {
    throw new ApiError('Impossible de joindre le serveur')
  }

  if (!response.ok) {
    throw new ApiError(response.status === 401 ? 'Email ou mot de passe incorrect' : 'Erreur serveur', response.status)
  }

  const data = (await response.json()) as { token: string }
  return data.token
}

export interface Room {
  id: string
  name: string
  createdAt: string
  /** Au moins une mesure périmée parmi les devices de la salle — voir domain/services/freshness.ts. */
  hasSilentDevice: boolean
}

export interface LatestMeasurement {
  id: string
  deviceId: string
  deviceName: string
  type: string
  value: number
  unit: string | null
  timestamp: string
  receivedAt: string
  /** Calculé côté backend (domain/services/freshness.ts) : la mesure elle-même est-elle encore à jour ? */
  fresh: boolean
}

async function authorizedGet<T>(path: string, token: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  } catch {
    throw new ApiError('Impossible de joindre le serveur')
  }

  if (!response.ok) {
    throw new ApiError(response.status === 401 ? 'Session expirée, reconnecte-toi' : 'Erreur serveur', response.status)
  }

  return (await response.json()) as T
}

export function fetchRooms(token: string): Promise<Room[]> {
  return authorizedGet<Room[]>('/rooms', token)
}

export function fetchLatestMeasurements(token: string, roomId: string): Promise<LatestMeasurement[]> {
  return authorizedGet<LatestMeasurement[]>(`/rooms/${roomId}/measurements/latest`, token)
}

export interface AssociatedDevice {
  id: string
  name: string
  type: string
  roomId: string
  createdAt: string
}

/**
 * Messages adaptés au parcours de scan : un code au mauvais format (400) et
 * un code bien formé mais inconnu (404) sont deux échecs distincts que
 * l'écran de scan doit pouvoir afficher différemment.
 */
export async function associateDevice(token: string, roomId: string, identifier: string): Promise<AssociatedDevice> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/rooms/${roomId}/devices/associate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ identifier })
    })
  } catch {
    throw new ApiError('Impossible de joindre le serveur')
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? 'Session expirée, reconnecte-toi'
        : response.status === 403
          ? "Tu n'as pas les droits pour associer un équipement"
          : response.status === 404
            ? 'Aucun équipement ne correspond à ce code'
            : response.status === 400
              ? "Ce n'est pas un QR code Campify valide"
              : 'Erreur serveur'
    throw new ApiError(message, response.status)
  }

  return (await response.json()) as AssociatedDevice
}
