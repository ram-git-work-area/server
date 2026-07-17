import { randomUUID } from 'node:crypto';
import type { MatchingSession } from '@prisma/client';
import type {
  CreateMatchingSessionData,
  MatchingSessionRepositoryPort,
  UpdateMatchingSessionData,
} from '../../src/repositories/matching-session.repository';

export class MemoryMatchingSessionRepository implements MatchingSessionRepositoryPort {
  public sessions: MatchingSession[] = [];

  async findById(id: string) {
    return this.sessions.find((session) => session.id === id) ?? null;
  }

  async findByTripId(tripId: string) {
    return this.sessions.find((session) => session.tripId === tripId) ?? null;
  }

  async startForTrip(data: CreateMatchingSessionData) {
    const now = new Date();
    const existingIndex = this.sessions.findIndex((session) => session.tripId === data.tripId);

    const session: MatchingSession = {
      id: existingIndex >= 0 ? this.sessions[existingIndex]!.id : randomUUID(),
      tripId: data.tripId,
      status: 'SEARCHING',
      strategy: data.strategy,
      vehicleType: data.vehicleType,
      pickupLatitude: data.pickupLatitude,
      pickupLongitude: data.pickupLongitude,
      currentRadiusMeters: data.currentRadiusMeters,
      maxRadiusMeters: data.maxRadiusMeters,
      currentBatch: 0,
      notifiedRiderCount: 0,
      assignedRiderId: null,
      failureReason: null,
      startedAt: now,
      expiresAt: data.expiresAt,
      createdAt: existingIndex >= 0 ? this.sessions[existingIndex]!.createdAt : now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      this.sessions[existingIndex] = session;
    } else {
      this.sessions.push(session);
    }
    return session;
  }

  async update(id: string, data: UpdateMatchingSessionData) {
    const session = this.sessions.find((entry) => entry.id === id);
    if (!session) {
      throw new Error(`Matching session not found: ${id}`);
    }

    if (data.status !== undefined) session.status = data.status;
    if (data.currentRadiusMeters !== undefined)
      session.currentRadiusMeters = data.currentRadiusMeters;
    if (data.currentBatch !== undefined) session.currentBatch = data.currentBatch;
    if (data.notifiedRiderCount !== undefined) session.notifiedRiderCount = data.notifiedRiderCount;
    if (data.assignedRiderId !== undefined) session.assignedRiderId = data.assignedRiderId;
    if (data.failureReason !== undefined) session.failureReason = data.failureReason;
    if (data.expiresAt !== undefined) session.expiresAt = data.expiresAt;
    session.updatedAt = new Date();

    return session;
  }

  async incrementNotified(id: string, by: number) {
    const session = this.sessions.find((entry) => entry.id === id);
    if (!session) {
      throw new Error(`Matching session not found: ${id}`);
    }
    session.notifiedRiderCount += by;
    session.updatedAt = new Date();
    return session;
  }
}
