'use client';

import { useRef, type KeyboardEvent } from 'react';

import type { RegionId, RegionReading } from '@/lib/psi/types';
import { bandFor } from '@/lib/psi/bands';
import { REGION_NAMES } from '@/lib/psi/regions';

import { PANEL_ID, tabId } from './ids';

type RegionTabsProps = {
  regions: readonly RegionReading[];
  active: RegionId;
  onSelect: (region: RegionId) => void;
};

export function RegionTabs({ regions, active, onSelect }: RegionTabsProps) {
  const tabs = useRef(new Map<RegionId, HTMLButtonElement>());

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = regions.findIndex((region) => region.id === active);
    const last = regions.length - 1;
    const target: Record<string, number> = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in target)) return;
    event.preventDefault();
    const next = regions[target[event.key]].id;
    onSelect(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Regions"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-5 gap-1 rounded-2xl border border-hairline bg-surface p-1 backdrop-blur-xl"
    >
      {regions.map((region) => {
        const selected = region.id === active;
        return (
          <button
            key={region.id}
            ref={(node) => {
              if (node) tabs.current.set(region.id, node);
              else tabs.current.delete(region.id);
            }}
            type="button"
            role="tab"
            id={tabId(region.id)}
            aria-selected={selected}
            aria-controls={PANEL_ID}
            tabIndex={selected ? 0 : -1}
            data-band={region.psi === null ? 'none' : bandFor(region.psi).id}
            onClick={() => onSelect(region.id)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors duration-200 ${
              selected ? 'bg-text text-black' : 'text-muted hover:bg-white/5 hover:text-text'
            }`}
          >
            <span className="text-[0.8125rem] font-medium">{REGION_NAMES[region.id]}</span>
            <span className="flex items-center gap-1.5 text-xs tabular-nums">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-band" />
              <span className="sr-only">PSI </span>
              {region.psi ?? '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
