-- CreateTable
CREATE TABLE "RawMeasurement" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawMeasurement_deviceId_timestamp_idx" ON "RawMeasurement"("deviceId", "timestamp");
