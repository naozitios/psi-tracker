export const REGION_IDS = ['west', 'east', 'central', 'south', 'north'] as const;

export type RegionId = (typeof REGION_IDS)[number];

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type RegionReading = {
  id: RegionId;
  psi: number | null;
  pm25: number | null;
  location: LatLng;
};

export type PsiSnapshot = {
  readingAt: string;
  regions: RegionReading[];
  stale: boolean;
};

export type BandId = 'good' | 'moderate' | 'unhealthy' | 'very-unhealthy' | 'hazardous';

export type Band = {
  id: BandId;
  label: string;
  min: number;
  max: number;
};
