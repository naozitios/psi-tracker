'use client';

import { useCallback, useEffect, useState } from 'react';

import type { LatLng, RegionId, RegionReading } from '@/lib/psi/types';
import { GEOLOCATION_MAX_AGE_MS, GEOLOCATION_TIMEOUT_MS } from '@/lib/constants';
import { DEFAULT_REGION, regionForPosition } from '@/lib/psi/regions';
import { readStoredRegion, writeStoredRegion } from '@/lib/storage';

type LocationState =
  | { status: 'locating' }
  | { status: 'located'; position: LatLng }
  | { status: 'denied' | 'unavailable' | 'timeout' | 'unsupported' };

export type LocationStatus = LocationState['status'] | 'outside';
export type RegionSource = 'location' | 'manual' | 'stored' | 'default';

export type RegionChoice = {
  region: RegionId;
  source: RegionSource;
  locationStatus: LocationStatus;
  choose: (region: RegionId) => void;
  locate: () => void;
};

const GEOLOCATION_ERRORS: Record<number, 'denied' | 'unavailable' | 'timeout'> = {
  1: 'denied',
  2: 'unavailable',
  3: 'timeout',
};

const initialLocation = (): LocationState =>
  typeof navigator !== 'undefined' && !navigator.geolocation
    ? { status: 'unsupported' }
    : { status: 'locating' };

const initialStoredRegion = () => (typeof window === 'undefined' ? null : readStoredRegion());

export function useRegionChoice(regions: readonly RegionReading[] | null): RegionChoice {
  const [location, setLocation] = useState<LocationState>(initialLocation);
  const [manual, setManual] = useState<RegionId | null>(null);
  const [stored] = useState<RegionId | null>(initialStoredRegion);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    if (!navigator.geolocation) return;
    let active = true;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (active) {
          setLocation({
            status: 'located',
            position: { latitude: coords.latitude, longitude: coords.longitude },
          });
        }
      },
      (error) => {
        if (active) setLocation({ status: GEOLOCATION_ERRORS[error.code] ?? 'unavailable' });
      },
      {
        enableHighAccuracy: false,
        timeout: GEOLOCATION_TIMEOUT_MS,
        maximumAge: GEOLOCATION_MAX_AGE_MS,
      },
    );
    return () => {
      active = false;
    };
  }, [request]);

  const located =
    location.status === 'located' && regions ? regionForPosition(location.position, regions) : null;
  const locationStatus: LocationStatus =
    location.status === 'located' && regions && !located ? 'outside' : location.status;

  let region: RegionId = DEFAULT_REGION;
  let source: RegionSource = 'default';
  if (manual) {
    region = manual;
    source = 'manual';
  } else if (located) {
    region = located;
    source = 'location';
  } else if (stored) {
    region = stored;
    source = 'stored';
  }

  useEffect(() => {
    if (source === 'manual' || source === 'location') writeStoredRegion(region);
  }, [region, source]);

  const choose = useCallback((next: RegionId) => setManual(next), []);

  const locate = useCallback(() => {
    setManual(null);
    setLocation({ status: 'locating' });
    setRequest((count) => count + 1);
  }, []);

  return { region, source, locationStatus, choose, locate };
}
