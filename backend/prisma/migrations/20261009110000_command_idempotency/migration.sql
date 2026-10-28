-- Idempotence des demandes de commande J4 (ADR 0014) : une clé fournie par
-- le client, unique par utilisateur. Les commandes antérieures restent à NULL.
ALTER TABLE "Command" ADD COLUMN "requestedBy" TEXT;
ALTER TABLE "Command" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Command_requestedBy_idempotencyKey_key" ON "Command"("requestedBy", "idempotencyKey");
