-- Cycle de vie des commandes J4 (ADR 0014) : ACKED devient ACKNOWLEDGED,
-- ajout de TIMEOUT, date de timeout et ACK tardif.
ALTER TYPE "CommandStatus" RENAME VALUE 'ACKED' TO 'ACKNOWLEDGED';
ALTER TYPE "CommandStatus" ADD VALUE 'TIMEOUT';

ALTER TABLE "Command" ADD COLUMN "timedOutAt" TIMESTAMP(3);
ALTER TABLE "Command" ADD COLUMN "lateAckStatus" TEXT;
ALTER TABLE "Command" ADD COLUMN "lateAckAt" TIMESTAMP(3);

CREATE INDEX "Command_status_expiresAt_idx" ON "Command"("status", "expiresAt");
