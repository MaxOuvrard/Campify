import { Alert, AlertUpdate, NewAlert } from '../entities/Alert'

export interface AlertRepository {
  /** Alerte non résolue du couple (device, type), au plus une — invariant garanti aussi par la base. */
  findOpen(deviceId: string, measurementType: string): Promise<Alert | null>
  /** Si une alerte est déjà ouverte pour ce couple (écriture concurrente), la renvoie au lieu d'en créer une seconde. */
  open(input: NewAlert): Promise<Alert>
  /** Mesure toujours hors zone normale : met à jour la dernière valeur vue, sans créer d'alerte. */
  recordOngoing(id: string, update: AlertUpdate): Promise<void>
  resolve(id: string, update: AlertUpdate): Promise<void>
}
