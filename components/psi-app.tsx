'use client';

import { usePsiData } from '@/hooks/use-psi-data';
import { useRegionChoice, type RegionChoice } from '@/hooks/use-region-choice';
import { bandFor } from '@/lib/psi/bands';
import { REGION_NAMES } from '@/lib/psi/regions';

import { AppShell } from './app-shell';
import { Headline } from './headline';
import { LocationNote } from './location-note';
import { RegionTabs } from './region-tabs';
import { ErrorHero, LoadingHero, LoadingTabs } from './states';

function headlineTag(choice: RegionChoice): 'location' | 'locating' | null {
  if (choice.source === 'location') return 'location';
  if (choice.locationStatus === 'locating' && choice.source !== 'manual') return 'locating';
  return null;
}

export function PsiApp() {
  const { data, retry } = usePsiData();
  const choice = useRegionChoice(data.status === 'ready' ? data.snapshot.regions : null);

  if (data.status === 'loading')
    return <AppShell busy hero={<LoadingHero />} controls={<LoadingTabs />} />;
  if (data.status === 'error') return <AppShell hero={<ErrorHero onRetry={retry} />} />;

  const { snapshot } = data;
  const reading =
    snapshot.regions.find((region) => region.id === choice.region) ?? snapshot.regions[0];
  const regionName = REGION_NAMES[reading.id];

  return (
    <AppShell
      hero={
        <>
          <Headline
            reading={reading}
            readingAt={snapshot.readingAt}
            receivedAt={data.receivedAt}
            outdated={data.outdated}
            tag={headlineTag(choice)}
          />
          <LocationNote
            status={choice.locationStatus}
            source={choice.source}
            regionName={regionName}
            onLocate={choice.locate}
          />
          <p aria-live="polite" className="sr-only">
            {reading.psi === null
              ? `${regionName}: no PSI reading`
              : `${regionName}: PSI ${reading.psi}, ${bandFor(reading.psi).label}`}
          </p>
        </>
      }
      controls={
        <RegionTabs regions={snapshot.regions} active={reading.id} onSelect={choice.choose} />
      }
    />
  );
}
