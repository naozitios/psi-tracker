'use client';

import { useCallback, useEffect, useState } from 'react';

import type { PsiSnapshot } from '@/lib/psi/types';
import { PSI_API_ROUTE, REFRESH_AFTER_MS } from '@/lib/constants';
import { isReadingOutdated } from '@/lib/format';
import { isPsiSnapshot } from '@/lib/psi/guards';

export type PsiData =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; snapshot: PsiSnapshot; outdated: boolean; receivedAt: number };

async function fetchSnapshot(signal: AbortSignal): Promise<PsiSnapshot> {
  const response = await fetch(PSI_API_ROUTE, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`PSI route responded ${response.status}`);
  const body: unknown = await response.json();
  if (!isPsiSnapshot(body)) throw new Error('PSI route returned an unexpected shape');
  return body;
}

export function usePsiData(): { data: PsiData; retry: () => void } {
  const [data, setData] = useState<PsiData>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let receivedAt = 0;

    const load = (background: boolean) =>
      fetchSnapshot(controller.signal).then(
        (snapshot) => {
          receivedAt = Date.now();
          setData({
            status: 'ready',
            snapshot,
            outdated: snapshot.stale || isReadingOutdated(snapshot.readingAt, receivedAt),
            receivedAt,
          });
        },
        () => {
          // A failed background refresh keeps the reading already on screen.
          if (!controller.signal.aborted && !background) setData({ status: 'error' });
        },
      );

    void load(false);

    const refreshIfOld = () => {
      if (
        document.visibilityState === 'visible' &&
        receivedAt > 0 &&
        Date.now() - receivedAt > REFRESH_AFTER_MS
      ) {
        void load(true);
      }
    };
    document.addEventListener('visibilitychange', refreshIfOld);

    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', refreshIfOld);
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setData({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { data, retry };
}
