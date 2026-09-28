import type { LocationStatus, RegionSource } from '@/hooks/use-region-choice';

import { LocationArrow } from './icons';

type LocationNoteProps = {
  status: LocationStatus;
  source: RegionSource;
  regionName: string;
  onLocate: () => void;
};

const REASONS: Partial<Record<LocationStatus, string>> = {
  denied: 'Location access is off',
  timeout: 'Finding your location took too long',
  unavailable: "Your location isn't available right now",
  unsupported: "This browser can't share your location",
  outside: 'You seem to be outside Singapore',
};

const CAN_RETRY: ReadonlySet<LocationStatus> = new Set(['timeout', 'unavailable', 'located']);

export function LocationNote({ status, source, regionName, onLocate }: LocationNoteProps) {
  const reason = source === 'manual' ? undefined : REASONS[status];
  const showLocate = CAN_RETRY.has(status) && (source === 'manual' || reason !== undefined);

  if (!reason && !showLocate) return null;

  return (
    <div className="mt-6 flex flex-col items-center gap-4 text-center">
      {reason && (
        <p className="max-w-xs text-sm leading-relaxed text-muted">
          {reason}, so this shows {regionName}. Choose your area below.
        </p>
      )}
      {showLocate && (
        <button
          type="button"
          onClick={onLocate}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 text-[0.9375rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <LocationArrow />
          Use my location
        </button>
      )}
    </div>
  );
}
