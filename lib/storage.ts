import { REGION_STORAGE_KEY } from './constants';
import { isRegionId } from './psi/regions';
import type { RegionId } from './psi/types';

// Storage can throw in private mode or when site data is blocked; the app works without it.
export function readStoredRegion(): RegionId | null {
  try {
    const value = window.localStorage.getItem(REGION_STORAGE_KEY);
    return isRegionId(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredRegion(region: RegionId): void {
  try {
    window.localStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    // Ignore: remembering the region is a convenience.
  }
}
