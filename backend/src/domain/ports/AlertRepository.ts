import { Alert, AlertUpdate, NewAlert } from '../entities/Alert'

export interface AlertRepository {
  /** Alerte non résolue du couple (device, type), au plus une — invariant garanti aussi par la base. */
  findOpen(deviceId: string, measurementType: string): Promise<Alert | null>
  /** Si une alerte est déjà ouverte pour ce couple (écriture concurrente), la renvoie au lieu d'en créer une seconde. */
  open(input: NewAlert): Promise<Alert>
  /** Mesure toujours hors zone normale : met à jour la dernière valeur vue, sans créer d'alerte. */
  recordOngoing(id: string, update: AlertUpdate): Promise<void>
  resolve(id: string, update: AlertUpdate): Promise<void>

  // Lectures (process API) — l'API ne crée ni ne résout jamais d'alerte.
  /** Alertes non résolues de ces devices, plus récentes d'abord. */
  findOpenByDevices(deviceIds: string[]): Promise<Alert[]>
  /** Alertes actives à un moment de [from, to] (ouvertes avant `to`, non résolues avant `from`), plus récentes d'abord, au plus `limit`. */
  findByDevicesInRange(deviceIds: string[], from: Date, to: Date, limit: number): Promise<Alert[]>
  /** Nombre d'alertes non résolues par salle (salle courante du device) ; les salles sans alerte sont absentes. */
  countOpenByRoom(): Promise<Map<string, number>>
}
