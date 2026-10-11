import { Geolocation } from '@capacitor/geolocation';
import { isNative } from './native';
import type { LatLng, Position } from './types';

export function distanceMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatMiles(mi: number): string {
  if (mi < 0.1) return 'here';
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export async function getCurrentPosition(): Promise<Position> {
  if (isNative) {
    // Native permission prompt + GPS (the in-app browser's geolocation is less reliable).
    try {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') perm = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (perm.location === 'denied') throw new Error('Location permission was denied — allow it in your phone settings');
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
    } catch (e) {
      throw e instanceof Error && e.message.includes('permission') ? e : new Error('Could not get your location');
    }
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Location is not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied — allow it in your browser settings'
              : 'Could not get your location',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

export function directionsUrl(p: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}

export interface PlaceResult extends LatLng {
  name: string;
  address: string;
  /** Human label for the kind of place, e.g. "Park", "Sports field", "Street". */
  kind: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

const KIND_LABELS: Record<string, string> = {
  park: 'Park',
  pitch: 'Sports field / court',
  sports_centre: 'Sports centre',
  stadium: 'Stadium',
  track: 'Track',
  recreation_ground: 'Recreation ground',
  playground: 'Playground',
  beach: 'Beach',
  school: 'School',
  university: 'University',
  college: 'College',
  community_centre: 'Community centre',
  fitness_centre: 'Gym',
};

function describe(p: Record<string, string | undefined>): { kind: string; rank: number } {
  const key = p.osm_key ?? '';
  const value = p.osm_value ?? '';
  if (key === 'leisure' || key === 'sport') return { kind: KIND_LABELS[value] ?? 'Sports & leisure', rank: 0 };
  if (key === 'amenity') return { kind: KIND_LABELS[value] ?? 'Place', rank: 1 };
  if (key === 'natural' && value === 'beach') return { kind: 'Beach', rank: 1 };
  if (key === 'highway') return { kind: 'Street', rank: 3 };
  if (key === 'place' || key === 'boundary') return { kind: 'Area', rank: 3 };
  if (key === 'building' || p.type === 'house') return { kind: 'Address', rank: 2 };
  return { kind: 'Place', rank: 2 };
}

/**
 * Free place search via Photon (OpenStreetMap data). Parks, courts and fields
 * are ranked first; duplicate results (e.g. one street split into segments)
 * are collapsed.
 */
export async function searchPlaces(query: string, near?: LatLng, signal?: AbortSignal): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ q: query, limit: '15', lang: 'en' });
  if (near) {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lng));
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!res.ok) throw new Error('Place search failed');
  const data = (await res.json()) as { features: PhotonFeature[] };

  const seen = new Set<string>();
  const results: (PlaceResult & { rank: number; order: number })[] = [];
  data.features.forEach((f, order) => {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    const address = [street, p.city ?? p.town ?? p.village, p.state].filter(Boolean).join(', ');
    const name = p.name ?? (street || 'Unnamed place');
    const { kind, rank } = describe(p);
    const key = `${name}|${address}|${kind}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ name, address, kind, rank, order, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
  });

  return results
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, 6)
    .map(({ rank: _rank, order: _order, ...r }) => r);
}
