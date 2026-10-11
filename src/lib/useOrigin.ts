import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { getCurrentPosition } from './geo';
import type { LatLng } from './types';

/** Where to search from: the device's location if allowed, else the saved home location. */
export function useOrigin() {
  const { settings } = useAuth();
  const home = settings?.home_lat != null && settings?.home_lng != null ? { lat: settings.home_lat, lng: settings.home_lng } : null;

  const [here, setHere] = useState<LatLng | null>(null);
  const [mode, setMode] = useState<'here' | 'home'>(home ? 'home' : 'here');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setLocating(true);
    setError(null);
    try {
      setHere(await getCurrentPosition());
      setMode('here');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLocating(false);
    }
  }, []);

  // No home saved → try the device location once.
  useEffect(() => {
    if (!home && !here) void locate();
  }, [home === null]);

  const origin = mode === 'here' ? (here ?? home) : (home ?? here);
  return { origin, mode: origin === home ? 'home' : 'here', hasHome: !!home, locating, error, locate, switchToHome: () => setMode('home') } as const;
}

export const DEFAULT_CENTER: LatLng = { lat: 39.5, lng: -98.35 }; // middle of the US
