-- CreateEnum
CREATE TYPE "MatchingSessionStatus" AS ENUM ('SEARCHING', 'DISPATCHING', 'ASSIGNED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "MatchingSession" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "status" "MatchingSessionStatus" NOT NULL DEFAULT 'SEARCHING',
    "strategy" TEXT NOT NULL,
    "vehicleType" "TripVehicleType" NOT NULL,
    "pickupLatitude" DOUBLE PRECISION NOT NULL,
    "pickupLongitude" DOUBLE PRECISION NOT NULL,
    "currentRadiusMeters" INTEGER NOT NULL,
    "maxRadiusMeters" INTEGER NOT NULL,
    "currentBatch" INTEGER NOT NULL DEFAULT 0,
    "notifiedRiderCount" INTEGER NOT NULL DEFAULT 0,
    "assignedRiderId" TEXT,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchingSession_tripId_key" ON "MatchingSession"("tripId");

-- CreateIndex
CREATE INDEX "MatchingSession_status_idx" ON "MatchingSession"("status");

-- CreateIndex
CREATE INDEX "MatchingSession_status_expiresAt_idx" ON "MatchingSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MatchingSession_assignedRiderId_idx" ON "MatchingSession"("assignedRiderId");
