-- Contrat de commande J4 (ADR 0014) : paramètres obligatoires, date
-- d'expiration, motif d'échec et état rapporté par l'objet dans son ACK.

-- `payload` devient `params`, toujours présent (objet vide par défaut pour les anciennes lignes).
ALTER TABLE "Command" RENAME COLUMN "payload" TO "params";
UPDATE "Command" SET "params" = '{}'::jsonb WHERE "params" IS NULL;
ALTER TABLE "Command" ALTER COLUMN "params" SET NOT NULL;

-- Les commandes antérieures n'avaient pas d'expiration : on les considère expirées dès leur création.
ALTER TABLE "Command" ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "Command" SET "expiresAt" = "createdAt";
ALTER TABLE "Command" ALTER COLUMN "expiresAt" SET NOT NULL;

ALTER TABLE "Command" ADD COLUMN "failureReason" TEXT;
ALTER TABLE "Command" ADD COLUMN "reportedState" JSONB;
