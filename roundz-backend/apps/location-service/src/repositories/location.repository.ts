import { Types } from 'mongoose';
import type {
  LocationModels,
  LocationSource,
  OnlineStatus,
  RiderLocationHistoryDoc,
} from '../models/location.models';

type MongoQuery = Record<string, unknown>;
import { decodeHistoryCursor } from '../utils/cursor';

export type CurrentLocation = {
  riderId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  vehicleType: string | null;
  onlineStatus: OnlineStatus;
  lastUpdatedAt: Date;
};

export type NearbyRider = CurrentLocation & { distanceMeters: number };

export type HistoryEntry = {
  id: string;
  riderId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  source: LocationSource;
  timestamp: Date;
};

export type UpsertCurrentInput = {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  vehicleType: string | null;
  onlineStatus: OnlineStatus;
  lastUpdatedAt: Date;
};

export type HistoryInput = {
  riderId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  source: LocationSource;
  timestamp: Date;
};

export type NearbyParams = {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  vehicleType?: string;
  onlineOnly: boolean;
  limit: number;
};

export type HistoryQueryParams = {
  riderId?: string;
  tripId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
};

export interface LocationRepositoryPort {
  getCurrent(riderId: string): Promise<CurrentLocation | null>;
  upsertCurrent(riderId: string, input: UpsertCurrentInput): Promise<CurrentLocation>;
  setOffline(riderId: string): Promise<CurrentLocation | null>;
  findNearby(params: NearbyParams): Promise<NearbyRider[]>;
  findStaleOnline(olderThan: Date, limit: number): Promise<CurrentLocation[]>;
  appendHistoryMany(entries: HistoryInput[]): Promise<void>;
  listHistory(params: HistoryQueryParams): Promise<HistoryEntry[]>;
}

export class MongoLocationRepository implements LocationRepositoryPort {
  constructor(private readonly models: LocationModels) {}

  async getCurrent(riderId: string) {
    const doc = await this.models.CurrentLocation.findOne({ riderId }).lean().exec();
    return doc ? toCurrentLocation(doc) : null;
  }

  async upsertCurrent(riderId: string, input: UpsertCurrentInput) {
    const doc = await this.models.CurrentLocation.findOneAndUpdate(
      { riderId },
      {
        $set: {
          riderId,
          location: { type: 'Point', coordinates: [input.longitude, input.latitude] },
          latitude: input.latitude,
          longitude: input.longitude,
          heading: input.heading,
          speed: input.speed,
          accuracy: input.accuracy,
          altitude: input.altitude,
          vehicleType: input.vehicleType,
          onlineStatus: input.onlineStatus,
          lastUpdatedAt: input.lastUpdatedAt,
        },
      },
      { new: true, upsert: true },
    )
      .lean()
      .exec();

    return toCurrentLocation(doc);
  }

  async setOffline(riderId: string) {
    const doc = await this.models.CurrentLocation.findOneAndUpdate(
      { riderId, onlineStatus: 'ONLINE' },
      { $set: { onlineStatus: 'OFFLINE' } },
      { new: true },
    )
      .lean()
      .exec();

    return doc ? toCurrentLocation(doc) : null;
  }

  async findNearby(params: NearbyParams) {
    const query: MongoQuery = {};

    if (params.onlineOnly) {
      query.onlineStatus = 'ONLINE';
    }

    if (params.vehicleType) {
      query.vehicleType = params.vehicleType;
    }

    const results = await this.models.CurrentLocation.aggregate<
      RiderCurrentLocationLean & { distanceMeters: number }
    >([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [params.longitude, params.latitude] },
          distanceField: 'distanceMeters',
          maxDistance: params.radiusMeters,
          spherical: true,
          query,
        },
      },
      { $limit: params.limit },
    ]).exec();

    return results.map((doc) => ({
      ...toCurrentLocation(doc),
      distanceMeters: Math.round(doc.distanceMeters),
    }));
  }

  async findStaleOnline(olderThan: Date, limit: number) {
    const docs = await this.models.CurrentLocation.find({
      onlineStatus: 'ONLINE',
      lastUpdatedAt: { $lt: olderThan },
    })
      .limit(limit)
      .lean()
      .exec();

    return docs.map(toCurrentLocation);
  }

  async appendHistoryMany(entries: HistoryInput[]) {
    if (entries.length === 0) {
      return;
    }

    await this.models.LocationHistory.insertMany(
      entries.map((entry) => ({
        riderId: entry.riderId,
        tripId: entry.tripId,
        location: { type: 'Point', coordinates: [entry.longitude, entry.latitude] },
        latitude: entry.latitude,
        longitude: entry.longitude,
        heading: entry.heading,
        speed: entry.speed,
        accuracy: entry.accuracy,
        altitude: entry.altitude,
        source: entry.source,
        timestamp: entry.timestamp,
      })),
      { ordered: false },
    );
  }

  async listHistory(params: HistoryQueryParams) {
    const query: MongoQuery = {};

    if (params.riderId) {
      query.riderId = params.riderId;
    }

    if (params.tripId) {
      query.tripId = params.tripId;
    }

    if (params.from || params.to) {
      const timestampFilter: { $gte?: Date; $lte?: Date } = {};
      if (params.from) {
        timestampFilter.$gte = params.from;
      }
      if (params.to) {
        timestampFilter.$lte = params.to;
      }
      query.timestamp = timestampFilter;
    }

    const cursor = params.cursor ? decodeHistoryCursor(params.cursor) : null;
    if (cursor && Types.ObjectId.isValid(cursor.id)) {
      const cursorDate = new Date(cursor.timestampMs);
      const cursorId = new Types.ObjectId(cursor.id);
      query.$or = [
        { timestamp: { $lt: cursorDate } },
        { timestamp: cursorDate, _id: { $lt: cursorId } },
      ];
    }

    const docs = await this.models.LocationHistory.find(query)
      .sort({ timestamp: -1, _id: -1 })
      .limit(params.limit + 1)
      .lean()
      .exec();

    return docs.map(toHistoryEntry);
  }
}

type RiderCurrentLocationLean = {
  riderId: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  vehicleType: string | null;
  onlineStatus: OnlineStatus;
  lastUpdatedAt: Date;
};

function toCurrentLocation(doc: RiderCurrentLocationLean): CurrentLocation {
  return {
    riderId: doc.riderId,
    latitude: doc.latitude,
    longitude: doc.longitude,
    heading: doc.heading ?? null,
    speed: doc.speed ?? null,
    accuracy: doc.accuracy ?? null,
    altitude: doc.altitude ?? null,
    vehicleType: doc.vehicleType ?? null,
    onlineStatus: doc.onlineStatus,
    lastUpdatedAt: new Date(doc.lastUpdatedAt),
  };
}

function toHistoryEntry(doc: RiderLocationHistoryDoc & { _id: Types.ObjectId }): HistoryEntry {
  return {
    id: doc._id.toString(),
    riderId: doc.riderId,
    tripId: doc.tripId ?? null,
    latitude: doc.latitude,
    longitude: doc.longitude,
    heading: doc.heading ?? null,
    speed: doc.speed ?? null,
    accuracy: doc.accuracy ?? null,
    altitude: doc.altitude ?? null,
    source: doc.source,
    timestamp: new Date(doc.timestamp),
  };
}
