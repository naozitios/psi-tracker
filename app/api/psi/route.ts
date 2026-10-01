import { FRESH_CACHE_CONTROL, STALE_CACHE_CONTROL } from '@/lib/constants';
import { createPsiSource } from '@/lib/psi/source';

const getSnapshot = createPsiSource({
  apiKey: process.env.DATAGOV_KEY || undefined,
  onFallback: (error) => console.warn('[psi] upstream failed, serving last good reading:', error),
  onPm25Error: (error) => console.warn('[psi] PM2.5 unavailable:', error),
});

export async function GET() {
  try {
    const snapshot = await getSnapshot();
    return Response.json(snapshot, {
      headers: { 'Cache-Control': snapshot.stale ? STALE_CACHE_CONTROL : FRESH_CACHE_CONTROL },
    });
  } catch (error) {
    console.error('[psi] no PSI data available:', error);
    return Response.json(
      { error: 'PSI data is unavailable right now.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
