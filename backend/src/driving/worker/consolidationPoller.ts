import { Logger } from '../../domain/ports/Logger'
import { RawMeasurementRepository } from '../../domain/ports/RawMeasurementRepository'
import { MeasurementIngestionService } from '../../domain/services/MeasurementIngestionService'

export interface ConsolidationPollerDeps {
  ingestion: MeasurementIngestionService
  rawMeasurements: RawMeasurementRepository
  logger: Logger
  intervalMs: number
  batchSize: number
}

/**
 * Troisième entrée `driving`, symétrique à `driving/mqtt` et `driving/api` —
 * déclenche le même domaine (`MeasurementIngestionService.consolidate()`),
 * jamais de règle métier ici (voir ADR 0001, ADR 0011).
 *
 * Interroge la base brute toutes les `intervalMs` pour les lignes pas
 * encore consolidées, les traite **une par une, dans l'ordre** (jamais en
 * parallèle) : `consolidate()` compare chaque mesure à la dernière connue
 * pour son device+type, un traitement concurrent pourrait faire lire à deux
 * lignes du même device+type le même état "dernière connue" avant qu'aucune
 * des deux n'ait écrit, et accepter à tort les deux.
 */
export function startConsolidationPolling(deps: ConsolidationPollerDeps): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | null = null

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const pending = await deps.rawMeasurements.findUnconsolidated(deps.batchSize)
      for (const raw of pending) {
        if (stopped) break
        await deps.ingestion.consolidate(raw)
      }
    } catch (err) {
      deps.logger.error('consolidation polling tick failed', { error: (err as Error).message })
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), deps.intervalMs)
    }
  }

  void tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
