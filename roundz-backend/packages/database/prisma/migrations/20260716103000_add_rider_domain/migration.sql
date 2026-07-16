-- CreateEnum
CREATE TYPE "RiderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RiderOnboardingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RiderApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiderOnlineStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BIKE', 'AUTO', 'CAR', 'SUV', 'VAN', 'TRUCK');

-- CreateEnum
CREATE TYPE "RiderDocumentType" AS ENUM ('DRIVING_LICENSE', 'VEHICLE_RC', 'INSURANCE', 'PERMIT', 'PROFILE_PHOTO', 'IDENTITY_PROOF', 'ADDRESS_PROOF');

-- CreateEnum
CREATE TYPE "DocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateTable
CREATE TABLE "Rider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "riderCode" TEXT NOT NULL,
    "status" "RiderStatus" NOT NULL DEFAULT 'ACTIVE',
    "onboardingStatus" "RiderOnboardingStatus" NOT NULL DEFAULT 'PENDING',
    "approvalStatus" "RiderApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "onlineStatus" "RiderOnlineStatus" NOT NULL DEFAULT 'OFFLINE',
    "profilePhoto" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTrips" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "registrationState" TEXT NOT NULL,
    "manufacturingYear" INTEGER NOT NULL,
    "insuranceExpiry" TIMESTAMP(3),
    "permitExpiry" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderDocument" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "documentType" "RiderDocumentType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "verificationStatus" "DocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "RiderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPreference" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "autoAcceptTrips" BOOLEAN NOT NULL DEFAULT false,
    "receivePromotions" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rider_userId_key" ON "Rider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Rider_riderCode_key" ON "Rider"("riderCode");

-- CreateIndex
CREATE INDEX "Rider_approvalStatus_onboardingStatus_idx" ON "Rider"("approvalStatus", "onboardingStatus");

-- CreateIndex
CREATE INDEX "Rider_onlineStatus_idx" ON "Rider"("onlineStatus");

-- CreateIndex
CREATE INDEX "Rider_status_idx" ON "Rider"("status");

-- CreateIndex
CREATE INDEX "Rider_createdAt_idx" ON "Rider"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_registrationNumber_key" ON "Vehicle"("registrationNumber");

-- CreateIndex
CREATE INDEX "Vehicle_riderId_isPrimary_idx" ON "Vehicle"("riderId", "isPrimary");

-- CreateIndex
CREATE INDEX "Vehicle_riderId_createdAt_idx" ON "Vehicle"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderDocument_riderId_documentType_idx" ON "RiderDocument"("riderId", "documentType");

-- CreateIndex
CREATE INDEX "RiderDocument_riderId_verificationStatus_idx" ON "RiderDocument"("riderId", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPreference_riderId_key" ON "RiderPreference"("riderId");

-- AddForeignKey
ALTER TABLE "Rider" ADD CONSTRAINT "Rider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderDocument" ADD CONSTRAINT "RiderDocument_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPreference" ADD CONSTRAINT "RiderPreference_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Rider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

