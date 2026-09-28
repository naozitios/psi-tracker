import type { RegionId } from '@/lib/psi/types';

export const PANEL_ID = 'psi-panel';

export const tabId = (region: RegionId) => `region-tab-${region}`;
