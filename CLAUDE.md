@AGENTS.md

# PSI Tracker

One-screen Next.js 16 app showing Singapore's 24-hour PSI for the user's nearest region. The spec is the "PRD: Singapore PSI Haze Tracker" doc.

## Commands

```bash
npm run lint && npm run typecheck && npm test   # before every commit
npm run build && npm run test:e2e               # Playwright against the production build
```

## Conventions

- URLs, timings and thresholds live in `lib/constants.ts`; colours and fonts are tokens in `app/globals.css`.
- The browser only calls `/api/psi`. Upstream parsing lives in `lib/psi/parse.ts` and must keep tolerating missing or extra regions.
- Location never leaves the browser: nearest-region logic runs client-side in `hooks/use-region-choice.ts`.
- Bands, distances, parsing and the route each have unit tests in `tests/unit`; UI flows are covered in `tests/components` and `e2e`.
