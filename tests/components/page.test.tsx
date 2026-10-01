import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Home from '@/app/page';

import { jsonResponse, makeSnapshot } from '../helpers';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse(makeSnapshot())),
  );
});

describe('Home page', () => {
  it('has a page heading for screen readers', async () => {
    render(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Singapore PSI right now');
    await screen.findByRole('tabpanel');
  });

  it("links to NEA's haze site for official advice in a new tab", async () => {
    render(<Home />);
    const link = screen.getByRole('link', { name: /NEA haze advisory/ });
    expect(link).toHaveAttribute('href', 'https://www.haze.gov.sg/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    await screen.findByRole('tabpanel');
  });

  it('credits NEA and data.gov.sg as the source', async () => {
    render(<Home />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'Data from the National Environment Agency via data.gov.sg',
    );
    await screen.findByRole('tabpanel');
  });
});
