-- Alertes avec cycle de vie ouverture/retour à la normale (ADR 0014).
-- `openKey` unique et nullable : au plus une alerte ouverte par
-- (device, type de mesure), voir schema.prisma.

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "measurementType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "triggerValue" DOUBLE PRECISION NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "openedEventId" TEXT,
    "lastValue" DOUBLE PRECISION NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedValue" DOUBLE PRECISION,
    "resolvedEventId" TEXT,
    "openKey" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_openKey_key" ON "Alert"("openKey");

-- CreateIndex
CREATE INDEX "Alert_deviceId_openedAt_idx" ON "Alert"("deviceId", "openedAt");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
