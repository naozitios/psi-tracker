export const APP_NAME = 'Haze';

export const PSI_SOURCE_URL = 'https://api-open.data.gov.sg/v2/real-time/api/psi';
export const PM25_SOURCE_URL = 'https://api-open.data.gov.sg/v2/real-time/api/pm25';
export const NEA_HAZE_URL = 'https://www.haze.gov.sg/';

export const PSI_API_ROUTE = '/api/psi';

export const CACHE_SECONDS = 300;
export const FRESH_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
export const STALE_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
export const UPSTREAM_TIMEOUT_MS = 8_000;

// PSI is published hourly, so a reading older than two hours means the feed has stalled.
export const OUTDATED_AFTER_MS = 2 * 60 * 60 * 1000;
export const REFRESH_AFTER_MS = CACHE_SECONDS * 1000;

export const GEOLOCATION_TIMEOUT_MS = 8_000;
export const GEOLOCATION_MAX_AGE_MS = 10 * 60 * 1000;
// Singapore is about 50 km across, so anything further from every region label is off the island.
export const MAX_REGION_DISTANCE_KM = 50;

export const REGION_STORAGE_KEY = 'psi-tracker:region';
export const TIME_ZONE = 'Asia/Singapore';
