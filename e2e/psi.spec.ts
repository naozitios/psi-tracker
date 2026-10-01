import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PLACES = {
  changiAirport: { latitude: 1.3644, longitude: 103.9915 },
  woodlands: { latitude: 1.4382, longitude: 103.789 },
};

const LOCATIONS = {
  west: { latitude: 1.35735, longitude: 103.7 },
  east: { latitude: 1.35735, longitude: 103.94 },
  central: { latitude: 1.35735, longitude: 103.82 },
  south: { latitude: 1.29587, longitude: 103.82 },
  north: { latitude: 1.41803, longitude: 103.82 },
};

function snapshot(overrides: { stale?: boolean } = {}) {
  const values = { west: 104, east: 87, central: 93, south: 99, north: 112 };
  return {
    readingAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    stale: false,
    ...overrides,
    regions: Object.entries(values).map(([id, psi]) => ({
      id,
      psi,
      pm25: Math.round(psi / 3),
      location: LOCATIONS[id as keyof typeof LOCATIONS],
    })),
  };
}

async function mockApi(page: Page, ...replies: { status: number; body: unknown }[]) {
  let calls = 0;
  await page.route('**/api/psi', (route) => {
    const reply = replies[Math.min(calls, replies.length - 1)];
    calls += 1;
    return route.fulfill({ status: reply.status, json: reply.body });
  });
  return () => calls;
}

const ok = (body = snapshot()) => ({ status: 200, body });
const panel = (page: Page) => page.getByRole('tabpanel');
const regionHeading = (page: Page) => panel(page).getByRole('heading', { level: 2 });

// Page-relative top edges of the label and big number; page-relative so clicking below the fold,
// which scrolls, isn't mistaken for a layout shift.
async function readingPosition(page: Page) {
  const main = page.getByRole('main');
  await expect(main.locator('.display-number')).toBeVisible();
  return main.evaluate((element) => {
    const top = (node: Element | null | undefined) =>
      node ? node.getBoundingClientRect().top + window.scrollY : null;
    const label = [...element.querySelectorAll('.eyebrow')].find(
      (node) => node.textContent === '24-hour PSI',
    );
    return { label: top(label), reading: top(element.querySelector('.display-number')) };
  });
}

test.describe('with location allowed', () => {
  test.use({ permissions: ['geolocation'], geolocation: PLACES.changiAirport });

  test('shows the PSI for the nearest region', async ({ page }) => {
    await mockApi(page, ok());
    await page.goto('/');

    await expect(regionHeading(page)).toHaveText('East');
    await expect(panel(page)).toContainText('87');
    await expect(panel(page)).toContainText('Moderate');
    await expect(page.getByText('Your location')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^East/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('switches regions without another request', async ({ page }) => {
    const calls = await mockApi(page, ok());
    await page.goto('/');
    await expect(regionHeading(page)).toHaveText('East');

    await page.getByRole('tab', { name: /^North/ }).click();
    await expect(regionHeading(page)).toHaveText('North');
    await expect(panel(page)).toContainText('Unhealthy');

    await page.getByRole('tab', { name: /^West/ }).click();
    await expect(regionHeading(page)).toHaveText('West');
    expect(calls()).toBe(1);
  });

  test('remembers a picked region after a reload', async ({ page, context }) => {
    await mockApi(page, ok());
    await page.goto('/');
    await page.getByRole('tab', { name: /^South/ }).click();

    await context.clearPermissions();
    await page.reload();
    await expect(regionHeading(page)).toHaveText('South');
  });

  test('keeps the reading still when switching regions or relocating', async ({ page }) => {
    await mockApi(page, ok());
    await page.goto('/');
    await expect(regionHeading(page)).toHaveText('East');
    const before = await readingPosition(page);

    await page.getByRole('tab', { name: /^North/ }).click();
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    expect(await readingPosition(page)).toEqual(before);

    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(regionHeading(page)).toHaveText('East');
    expect(await readingPosition(page)).toEqual(before);
  });

  test('labels fallback data as possibly outdated', async ({ page }) => {
    await mockApi(page, ok(snapshot({ stale: true })));
    await page.goto('/');
    await expect(page.getByText('May be outdated')).toBeVisible();
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await mockApi(page, ok());
    await page.goto('/');
    await expect(regionHeading(page)).toHaveText('East');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('with location blocked', () => {
  test('falls back to Central and explains why', async ({ page }) => {
    await mockApi(page, ok());
    await page.goto('/');

    await expect(regionHeading(page)).toHaveText('Central');
    await expect(page.getByText('Location is off. Pick your area below.')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Central/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('keeps the reading still when the location note goes away', async ({ page }) => {
    await mockApi(page, ok());
    await page.goto('/');
    await expect(page.getByText('Location is off. Pick your area below.')).toBeVisible();
    const before = await readingPosition(page);

    await page.getByRole('tab', { name: /^East/ }).click();
    await expect(page.getByText('Location is off. Pick your area below.')).toBeHidden();
    expect(await readingPosition(page)).toEqual(before);
  });

  test('lines the loading placeholder up with the reading that replaces it', async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/psi', async (route) => {
      await gate;
      await route.fulfill({ json: snapshot() });
    });
    await page.goto('/');
    await expect(page.getByText('Loading the latest PSI readings')).toBeAttached();
    const loading = await readingPosition(page);

    release();
    await expect(regionHeading(page)).toHaveText('Central');
    expect(await readingPosition(page)).toEqual(loading);
  });

  test('supports keyboard navigation between regions', async ({ page }) => {
    await mockApi(page, ok());
    await page.goto('/');
    await expect(regionHeading(page)).toHaveText('Central');

    await page.getByRole('tab', { name: /^Central/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(regionHeading(page)).toHaveText('South');
    await expect(page.getByRole('tab', { name: /^South/ })).toBeFocused();
  });

  test('shows an error and recovers with Try again', async ({ page }) => {
    await mockApi(page, { status: 502, body: { error: 'down' } }, ok());
    await page.goto('/');

    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      "We couldn't load the latest readings",
    );
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(regionHeading(page)).toHaveText('Central');
  });

  test('fits a small phone without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await mockApi(page, ok());
    await page.goto('/');
    await expect(regionHeading(page)).toHaveText('Central');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.getByRole('tab', { name: /^North/ })).toBeInViewport();
  });
});

test('the real API route answers with JSON and the right cache headers', async ({ request }) => {
  const response = await request.get('/api/psi');
  const body: unknown = await response.json();

  // data.gov.sg may be unreachable from the test machine, so accept either outcome.
  if (response.status() === 200) {
    expect(body).toMatchObject({ stale: false, regions: expect.any(Array) });
    expect(response.headers()['cache-control']).toContain('s-maxage=300');
  } else {
    expect(response.status()).toBe(502);
    expect(body).toEqual({ error: 'PSI data is unavailable right now.' });
    expect(response.headers()['cache-control']).toBe('no-store');
  }
});
