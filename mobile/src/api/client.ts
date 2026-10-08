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

export interface HistoryPoint {
  id: string
  deviceId: string
  type: string
  value: number
  unit: string | null
  timestamp: string
}

/** Historique borné côté backend (fenêtre 24h par défaut, voir domain/services/history.ts) — toutes métriques du device confondues, triées du plus ancien au plus récent. */
export function fetchDeviceHistory(token: string, deviceId: string): Promise<HistoryPoint[]> {
  return authorizedGet<HistoryPoint[]>(`/devices/${deviceId}/measurements`, token)
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

// --- Commandes (J4, docs/decisions/0014-cycle-de-vie-des-commandes.md) ----

/**
 * Cycle de vie côté backend. SENT = le broker MQTT a la commande, PAS
 * l'objet ; seul ACKNOWLEDGED signifie « exécutée par l'objet ». TIMEOUT
 * = aucune réponse : l'état réel de l'objet est inconnu.
 */
export type CommandStatus = 'PENDING' | 'SENT' | 'ACKNOWLEDGED' | 'FAILED' | 'TIMEOUT'

export interface Command {
  id: string
  deviceId: string
  type: string
  params: Record<string, unknown>
  status: CommandStatus
  createdAt: string
  expiresAt: string
  sentAt: string | null
  ackedAt: string | null
  timedOutAt: string | null
  failureReason: string | null
  reportedState: Record<string, unknown> | null
  /** ACK reçu après le TIMEOUT : le statut reste TIMEOUT, mais ce que l'objet a fini par répondre est exposé. */
  lateAck: { status: 'executed' | 'rejected' | 'expired'; at: string } | null
}

export interface CommandRequest {
  type: string
  params: Record<string, unknown>
}

/**
 * Une seule tentative. `idempotencyKey` identifie l'intention de
 * l'utilisateur : la réutiliser telle quelle pour un nouvel essai garantit
 * qu'une requête arrivée au backend (mais dont la réponse s'est perdue) ne
 * crée pas une seconde commande. Une erreur sans `status` = pas de réponse
 * du serveur (réseau) : on ne sait pas si la demande est arrivée.
 */
export async function sendCommand(token: string, deviceId: string, request: CommandRequest, idempotencyKey: string): Promise<Command> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(request)
    })
  } catch {
    throw new ApiError('Impossible de joindre le serveur')
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? 'Session expirée, reconnecte-toi'
        : response.status === 403
          ? "Tu n'as pas les droits pour piloter cet équipement"
          : response.status === 404
            ? 'Équipement inconnu'
            : response.status === 400 || response.status === 409
              ? 'Commande refusée par le serveur'
              : 'Erreur serveur'
    throw new ApiError(message, response.status)
  }

  return (await response.json()) as Command
}

export function fetchCommand(token: string, commandId: string): Promise<Command> {
  return authorizedGet<Command>(`/commands/${commandId}`, token)
}
