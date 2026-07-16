import { Schema, type Connection, type Model } from 'mongoose';

export type OnlineStatus = 'ONLINE' | 'OFFLINE';
export type LocationSource = 'GPS' | 'NETWORK' | 'MOCK';

export type GeoPoint = {
  type: 'Point';
  coordinates: [number, number];
};

export interface RiderCurrentLocationDoc {
  riderId: string;
  location: GeoPoint;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  vehicleType: string | null;
  onlineStatus: OnlineStatus;
  lastUpdatedAt: Date;
}

export interface RiderLocationHistoryDoc {
  riderId: string;
  tripId: string | null;
  location: GeoPoint;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  altitude: number | null;
  source: LocationSource;
  timestamp: Date;
}

export type LocationModels = {
  CurrentLocation: Model<RiderCurrentLocationDoc>;
  LocationHistory: Model<RiderLocationHistoryDoc>;
};

export type LocationModelOptions = {
  historyRetentionDays: number;
  currentRetentionDays: number;
};

const geoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

export function createLocationModels(
  connection: Connection,
  options: LocationModelOptions,
): LocationModels {
  const currentSchema = new Schema<RiderCurrentLocationDoc>(
    {
      riderId: { type: String, required: true, unique: true },
      location: { type: geoPointSchema, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      heading: { type: Number, default: null },
      speed: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      altitude: { type: Number, default: null },
      vehicleType: { type: String, default: null },
      onlineStatus: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'OFFLINE' },
      lastUpdatedAt: { type: Date, required: true },
    },
    { collection: 'rider_current_locations', versionKey: false },
  );

  currentSchema.index({ location: '2dsphere' });
  currentSchema.index({ onlineStatus: 1, lastUpdatedAt: 1 });

  if (options.currentRetentionDays > 0) {
    currentSchema.index(
      { lastUpdatedAt: 1 },
      { expireAfterSeconds: options.currentRetentionDays * 24 * 60 * 60 },
    );
  }

  const historySchema = new Schema<RiderLocationHistoryDoc>(
    {
      riderId: { type: String, required: true },
      tripId: { type: String, default: null },
      location: { type: geoPointSchema, required: true },
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      heading: { type: Number, default: null },
      speed: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      altitude: { type: Number, default: null },
      source: { type: String, enum: ['GPS', 'NETWORK', 'MOCK'], default: 'GPS' },
      timestamp: { type: Date, required: true },
    },
    { collection: 'rider_location_history', versionKey: false },
  );

  historySchema.index({ riderId: 1, timestamp: -1 });
  historySchema.index({ tripId: 1, timestamp: -1 });
  historySchema.index({ timestamp: -1 });
  historySchema.index({ location: '2dsphere' });

  if (options.historyRetentionDays > 0) {
    historySchema.index(
      { timestamp: 1 },
      { expireAfterSeconds: options.historyRetentionDays * 24 * 60 * 60 },
    );
  }

  const CurrentLocation =
    (connection.models.RiderCurrentLocation as Model<RiderCurrentLocationDoc> | undefined) ??
    connection.model<RiderCurrentLocationDoc>('RiderCurrentLocation', currentSchema);
  const LocationHistory =
    (connection.models.RiderLocationHistory as Model<RiderLocationHistoryDoc> | undefined) ??
    connection.model<RiderLocationHistoryDoc>('RiderLocationHistory', historySchema);

  return { CurrentLocation, LocationHistory };
}
