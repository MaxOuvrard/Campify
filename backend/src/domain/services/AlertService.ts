import { AlertRepository } from '../ports/AlertRepository'
import { Logger } from '../ports/Logger'
import { Measurement } from '../entities/Measurement'
import { AlertReason } from '../entities/Alert'
import { AlertThreshold, decideAlertTransition } from './alerts'

const EVENT_TYPE = 'alert'

/**
 * Applique la règle d'alerte (domain/services/alerts.ts, ADR 0014) à une
 * mesure déjà acceptée par la consolidation — doublons et retards ont été
 * rejetés avant, une mesure ancienne ne peut donc ni ouvrir ni fermer une
 * alerte. Ne journalise que les transitions (`opened`, `resolved`), jamais
 * les mesures intermédiaires : un incident = deux lignes de log, avec
 * l'`eventId` de la mesure qui a provoqué chacune.
 */
export class AlertService {
  constructor(
    private readonly alerts: AlertRepository,
    private readonly logger: Logger,
    private readonly thresholds: AlertThreshold[]
  ) {}

  async evaluate(measurement: Measurement, eventId: string): Promise<void> {
    const threshold = this.thresholds.find((t) => t.type === measurement.type)
    if (!threshold) return

    const open = await this.alerts.findOpen(measurement.deviceId, measurement.type)
    const transition = decideAlertTransition(open, measurement.value, threshold)
    const update = { value: measurement.value, at: measurement.timestamp, eventId }

    switch (transition.kind) {
      case 'none':
        return
      case 'ongoing':
        await this.alerts.recordOngoing(open!.id, update)
        return
      case 'open':
        await this.openAlert(measurement, eventId, transition.reason, transition.threshold)
        return
      case 'resolve':
        await this.alerts.resolve(open!.id, update)
        this.logger.info('alert resolved', {
          eventType: EVENT_TYPE,
          eventId,
          alertId: open!.id,
          deviceId: measurement.deviceId,
          type: measurement.type,
          value: measurement.value,
          reason: open!.reason,
          threshold: open!.threshold,
          status: 'resolved'
        })
        if (transition.reopen) {
          await this.openAlert(measurement, eventId, transition.reopen.reason, transition.reopen.threshold)
        }
    }
  }

  private async openAlert(measurement: Measurement, eventId: string, reason: AlertReason, threshold: number): Promise<void> {
    const alert = await this.alerts.open({
      deviceId: measurement.deviceId,
      measurementType: measurement.type,
      reason,
      threshold,
      triggerValue: measurement.value,
      openedAt: measurement.timestamp,
      openedEventId: eventId
    })
    this.logger.warn('alert opened', {
      eventType: EVENT_TYPE,
      eventId,
      alertId: alert.id,
      deviceId: measurement.deviceId,
      type: measurement.type,
      value: measurement.value,
      reason,
      threshold,
      status: 'opened'
    })
  }
}
