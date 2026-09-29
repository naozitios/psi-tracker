import type { LocationStatus, RegionSource } from '@/hooks/use-region-choice';

import { NOTE_ROW } from './headline-layout';
import { LocationArrow } from './icons';

type LocationNoteProps = {
  status: LocationStatus;
  source: RegionSource;
  onLocate: () => void;
};

const REASONS: Partial<Record<LocationStatus, string>> = {
  denied: 'Location is off. Pick your area below.',
  timeout: 'Location timed out.',
  unavailable: 'Location unavailable.',
  unsupported: "This browser can't share location.",
  outside: 'You seem to be outside Singapore.',
};

const CAN_RETRY: ReadonlySet<LocationStatus> = new Set(['timeout', 'unavailable', 'located']);

// The row always renders at full height so tapping a region never moves the reading above it.
export function LocationNote({ status, source, onLocate }: LocationNoteProps) {
  const reason = source === 'manual' ? undefined : REASONS[status];
  const showLocate = CAN_RETRY.has(status) && (source === 'manual' || reason !== undefined);

  return (
    <div className={NOTE_ROW}>
      {reason && <p className="swap text-sm leading-snug text-muted">{reason}</p>}
      {showLocate && (
        <button
          type="button"
          onClick={onLocate}
          className="swap inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 text-[0.9375rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          <LocationArrow />
          Use my location
        </button>
      )}
    </div>
  );
}
