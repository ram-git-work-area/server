-- CreateEnum
CREATE TYPE "TripVehicleType" AS ENUM ('BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK');

-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('RIDE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('REQUESTED', 'SEARCHING_RIDER', 'RIDER_ASSIGNED', 'RIDER_ARRIVING', 'OTP_PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "TripPaymentMethod" AS ENUM ('CASH', 'WALLET', 'CARD', 'UPI');

-- CreateEnum
CREATE TYPE "TripCancelledBy" AS ENUM ('CUSTOMER', 'RIDER', 'SYSTEM', 'ADMIN');

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "tripNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "riderId" TEXT,
    "vehicleType" "TripVehicleType" NOT NULL,
    "tripType" "TripType" NOT NULL DEFAULT 'RIDE',
    "status" "TripStatus" NOT NULL DEFAULT 'REQUESTED',
    "pickupLatitude" DOUBLE PRECISION NOT NULL,
    "pickupLongitude" DOUBLE PRECISION NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "dropLatitude" DOUBLE PRECISION NOT NULL,
    "dropLongitude" DOUBLE PRECISION NOT NULL,
    "dropAddress" TEXT NOT NULL,
    "estimatedDistance" DOUBLE PRECISION NOT NULL,
    "estimatedDuration" INTEGER NOT NULL,
    "estimatedFare" DOUBLE PRECISION NOT NULL,
    "actualFare" DOUBLE PRECISION,
    "paymentMethod" "TripPaymentMethod" NOT NULL,
    "cancellationReason" TEXT,
    "cancelledBy" "TripCancelledBy",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripTimeline" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Trip_tripNumber_key" ON "Trip"("tripNumber");

-- CreateIndex
CREATE INDEX "Trip_customerId_status_idx" ON "Trip"("customerId", "status");

-- CreateIndex
CREATE INDEX "Trip_customerId_createdAt_idx" ON "Trip"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_riderId_idx" ON "Trip"("riderId");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE INDEX "Trip_createdAt_idx" ON "Trip"("createdAt");

-- CreateIndex
CREATE INDEX "TripTimeline_tripId_createdAt_idx" ON "TripTimeline"("tripId", "createdAt");

-- AddForeignKey
ALTER TABLE "TripTimeline" ADD CONSTRAINT "TripTimeline_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

