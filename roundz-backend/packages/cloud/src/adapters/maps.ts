import type { MapsProvider } from '../interfaces';

export class GoogleMapsAdapter implements MapsProvider {
  async geocode(_address: string) {
    return { lat: 0, lng: 0 };
  }

  async estimateRoute(_input: {
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
  }) {
    return { distanceMeters: 0, durationSeconds: 0 };
  }
}

export class OpenStreetMapAdapter extends GoogleMapsAdapter {}
