-- AlterTable
ALTER TABLE "RawMeasurement" ADD COLUMN "consolidatedAt" TIMESTAMP(3);

-- Backfill : les lignes qui existaient déjà avant cette migration ont été
-- traitées par l'ancien chemin synchrone (MeasurementIngestionService.ingest(),
-- avant l'ADR 0011) — elles sont donc déjà consolidées, pas "en attente".
-- Sans ce backfill, le worker de consolidation rejouerait tout l'historique
-- existant au démarrage (inoffensif par construction, la dédup rejette tout
-- ce qui est plus vieux que l'état déjà connu, mais inutile et lent sur une
-- base avec beaucoup d'historique). Un no-op sur une base neuve (0 ligne).
UPDATE "RawMeasurement" SET "consolidatedAt" = "receivedAt" WHERE "consolidatedAt" IS NULL;

-- CreateIndex
CREATE INDEX "RawMeasurement_consolidatedAt_receivedAt_idx" ON "RawMeasurement"("consolidatedAt", "receivedAt");
