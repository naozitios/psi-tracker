import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LatLng, PsiSnapshot } from '@/lib/psi/types';
import { PsiApp } from '@/components/psi-app';
import { REGION_STORAGE_KEY } from '@/lib/constants';

import { jsonResponse, makeSnapshot, PLACES } from '../helpers';

type Success = (position: GeolocationPosition) => void;
type Failure = (error: GeolocationPositionError) => void;

function mockGeolocation() {
  const pending: { success: Success; failure: Failure }[] = [];
  const getCurrentPosition = vi.fn((success: Success, failure: Failure) => {
    pending.push({ success, failure });
  });
  vi.stubGlobal(
    'navigator',
    Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition } }),
  );

  const latest = () => {
    const request = pending.at(-1);
    if (!request) throw new Error('geolocation was not requested');
    return request;
  };
  return {
    getCurrentPosition,
    resolve: (position: LatLng) =>
      act(() => latest().success({ coords: position } as unknown as GeolocationPosition)),
    reject: (code: 1 | 2 | 3) =>
      act(() => latest().failure({ code } as unknown as GeolocationPositionError)),
  };
}

function mockApi(...bodies: (PsiSnapshot | { status: number })[]) {
  const queue = [...bodies];
  const fetch = vi.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return next && 'status' in next && !('regions' in next)
      ? jsonResponse({ error: 'unavailable' }, next.status)
      : jsonResponse(next);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const panel = () => screen.getByRole('tabpanel');
const regionHeading = () => within(panel()).getByRole('heading', { level: 2 });
const tab = (name: RegionName) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
type RegionName = 'West' | 'East' | 'Central' | 'South' | 'North';

async function renderLoaded() {
  const view = render(<PsiApp />);
  await screen.findByRole('tabpanel');
  return view;
}

let geo: ReturnType<typeof mockGeolocation>;

beforeEach(() => {
  geo = mockGeolocation();
});

describe('PsiApp', () => {
  it('shows a skeleton while the reading loads', async () => {
    mockApi(makeSnapshot());
    render(<PsiApp />);

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading the latest PSI readings')).toBeInTheDocument();
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'false');
  });

  it('only reads from the app’s own API route', async () => {
    const fetch = mockApi(makeSnapshot());
    await renderLoaded();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/psi', expect.anything());
  });

  it('shows the nearest region when location is allowed', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();

    expect(regionHeading()).toHaveTextContent('Central');
    expect(screen.getByText('Locating…')).toBeInTheDocument();

    await geo.resolve(PLACES.changiAirport);

    expect(regionHeading()).toHaveTextContent('East');
    expect(panel()).toHaveTextContent('PSI 87');
    expect(panel()).toHaveTextContent('Moderate');
    expect(screen.getByText('Your location')).toBeInTheDocument();
    expect(tab('East')).toHaveAttribute('aria-selected', 'true');
  });

  it('asks for location without high accuracy and with a timeout', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: false, timeout: 8000 }),
    );
  });

  it('falls back to Central with a note when location is denied', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    await geo.reject(1);

    expect(regionHeading()).toHaveTextContent('Central');
    expect(screen.getByText(/Location access is off, so this shows Central/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use my location' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your location')).not.toBeInTheDocument();
  });

  it('offers to try again when finding the location times out', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    await geo.reject(3);

    expect(screen.getByText(/took too long, so this shows Central/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Locating…')).toBeInTheDocument();

    await geo.resolve(PLACES.woodlands);
    expect(regionHeading()).toHaveTextContent('North');
  });

  it('explains when the device is outside Singapore', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    await geo.resolve(PLACES.kualaLumpur);

    expect(regionHeading()).toHaveTextContent('Central');
    expect(screen.getByText(/outside Singapore, so this shows Central/)).toBeInTheDocument();
  });

  it('explains when the browser cannot share location', async () => {
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: undefined }));
    mockApi(makeSnapshot());
    await renderLoaded();

    expect(
      screen.getByText(/can't share your location, so this shows Central/),
    ).toBeInTheDocument();
  });

  it('swaps regions instantly from data already loaded', async () => {
    const fetch = mockApi(makeSnapshot());
    await renderLoaded();

    await userEvent.click(tab('North'));

    expect(regionHeading()).toHaveTextContent('North');
    expect(panel()).toHaveTextContent('PSI 112');
    expect(panel()).toHaveTextContent('Unhealthy');
    expect(panel()).toHaveAttribute('data-band', 'unhealthy');
    expect(tab('North')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Central')).toHaveAttribute('aria-selected', 'false');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lists all five regions with their readings in the tabs', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((element) => element.textContent)).toEqual([
      'WestPSI 104',
      'EastPSI 87',
      'CentralPSI 93',
      'SouthPSI 99',
      'NorthPSI 112',
    ]);
  });

  it('supports arrow, Home and End keys in the region tabs', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    const user = userEvent.setup();

    tab('Central').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('South')).toHaveFocus();
    expect(regionHeading()).toHaveTextContent('South');

    await user.keyboard('{End}');
    expect(tab('North')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('West')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('North')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('West')).toHaveFocus();
    expect(regionHeading()).toHaveTextContent('West');
  });

  it('keeps a region the user picked even if location arrives later', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();

    await userEvent.click(tab('West'));
    await geo.resolve(PLACES.changiAirport);

    expect(regionHeading()).toHaveTextContent('West');
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    await geo.resolve(PLACES.changiAirport);
    expect(regionHeading()).toHaveTextContent('East');
    expect(screen.getByText('Your location')).toBeInTheDocument();
  });

  it('remembers the chosen region for the next visit', async () => {
    mockApi(makeSnapshot());
    const first = await renderLoaded();
    await userEvent.click(tab('South'));
    expect(window.localStorage.getItem(REGION_STORAGE_KEY)).toBe('south');
    first.unmount();

    geo = mockGeolocation();
    await renderLoaded();
    expect(regionHeading()).toHaveTextContent('South');

    await geo.reject(1);
    expect(screen.getByText(/so this shows South/)).toBeInTheDocument();
  });

  it('prefers the current location over a remembered region', async () => {
    window.localStorage.setItem(REGION_STORAGE_KEY, 'north');
    mockApi(makeSnapshot());
    await renderLoaded();
    expect(regionHeading()).toHaveTextContent('North');

    await geo.resolve(PLACES.jurongEast);
    expect(regionHeading()).toHaveTextContent('West');
    expect(window.localStorage.getItem(REGION_STORAGE_KEY)).toBe('west');
  });

  it('shows the one-hour PM2.5 and the reading time', async () => {
    mockApi(makeSnapshot({ readingAt: new Date().toISOString() }));
    await renderLoaded();
    expect(panel()).toHaveTextContent(/PM2\.5 27 µg\/m³ in the past hour/);
    expect(panel()).toHaveTextContent(/Updated \d{1,2}:\d{2} (am|pm)$/);
  });

  it('hides PM2.5 when it is unavailable', async () => {
    mockApi(makeSnapshot({ values: { central: { pm25: null } } }));
    await renderLoaded();
    expect(panel()).not.toHaveTextContent('PM2.5');
  });

  it('shows a dash when a region has no reading', async () => {
    mockApi(makeSnapshot({ values: { central: { psi: null } } }));
    await renderLoaded();
    expect(panel()).toHaveTextContent('PSI —');
    expect(panel()).toHaveTextContent('No reading');
    expect(panel()).toHaveAttribute('data-band', 'none');
  });

  it('labels fallback data as possibly outdated', async () => {
    mockApi(makeSnapshot({ stale: true }));
    await renderLoaded();
    expect(screen.getByText('May be outdated')).toBeInTheDocument();
  });

  it('labels a reading older than two hours as possibly outdated', async () => {
    mockApi(makeSnapshot({ readingAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }));
    await renderLoaded();
    expect(screen.getByText('May be outdated')).toBeInTheDocument();
  });

  it('does not label a fresh reading as outdated', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    expect(screen.queryByText('May be outdated')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when there is no data at all', async () => {
    const fetch = mockApi({ status: 502 }, makeSnapshot());
    render(<PsiApp />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("We couldn't load the latest readings");
    expect(within(alert).getByRole('link', { name: /NEA's haze site/ })).toHaveAttribute(
      'href',
      'https://www.haze.gov.sg/',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('tabpanel')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats an unexpected response body as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ regions: 'nope' })),
    );
    render(<PsiApp />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('announces the current reading politely for screen readers', async () => {
    mockApi(makeSnapshot());
    await renderLoaded();
    expect(screen.getByText('Central: PSI 93, Moderate')).toHaveAttribute('aria-live', 'polite');
  });

  describe('when the tab comes back into view', () => {
    const later = () => Date.now() + 6 * 60 * 1000;

    it('refreshes data older than five minutes', async () => {
      const fetch = mockApi(makeSnapshot(), makeSnapshot({ values: { central: { psi: 48 } } }));
      await renderLoaded();

      vi.spyOn(Date, 'now').mockReturnValue(later());
      act(() => document.dispatchEvent(new Event('visibilitychange')));

      await waitFor(() => expect(panel()).toHaveTextContent('PSI 48'));
      expect(panel()).toHaveTextContent('Good');
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not refresh data that is still recent', async () => {
      const fetch = mockApi(makeSnapshot());
      await renderLoaded();
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the current reading if the refresh fails', async () => {
      mockApi(makeSnapshot(), { status: 502 });
      await renderLoaded();

      vi.spyOn(Date, 'now').mockReturnValue(later());
      act(() => document.dispatchEvent(new Event('visibilitychange')));

      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
      expect(panel()).toHaveTextContent('PSI 93');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
