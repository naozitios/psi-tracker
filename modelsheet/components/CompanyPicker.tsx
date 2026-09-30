"use client";

import { useState } from "react";
import type { CompanyProfile } from "@/lib/sec/submissions";
import type { TickerEntry } from "@/lib/sec/tickers";
import type { Workbook } from "@/lib/sheet/types";

async function getJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export function CompanyPicker({ onBuilt }: { onBuilt: (workbook: Workbook) => void }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TickerEntry[] | null>(null);
  const [chosen, setChosen] = useState<TickerEntry | null>(null);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [busy, setBusy] = useState<"search" | "profile" | "build" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(entry: TickerEntry) {
    setChosen(entry);
    setProfile(null);
    setError(null);
    setBusy("profile");
    try {
      const data = await getJson<{ profile: CompanyProfile }>(
        await fetch(`/api/resolve?cik=${entry.cik}`),
      );
      setProfile(data.profile);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setError(null);
    setChosen(null);
    setProfile(null);
    setBusy("search");
    try {
      const data = await getJson<{ matches: TickerEntry[] }>(
        await fetch(`/api/resolve?q=${encodeURIComponent(query)}`),
      );
      setMatches(data.matches);
      const exact = data.matches.filter(
        (m) => m.ticker === query.trim().toUpperCase().replace(/[.\s/]/g, "-"),
      );
      setBusy(null);
      if (exact.length === 1) await choose(exact[0]);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function build() {
    if (!chosen) return;
    setError(null);
    setBusy("build");
    try {
      const data = await getJson<{ workbook: Workbook }>(
        await fetch("/api/model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cik: chosen.cik, ticker: chosen.ticker }),
        }),
      );
      onBuilt(data.workbook);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="picker">
      <h1>Build a company model from its filings</h1>
      <p className="muted">
        Five years of income statement, balance sheet and cash flow from SEC 10-K data, with a
        five-year forecast you can change in plain English.
      </p>

      <form className="search" onSubmit={search}>
        <input
          aria-label="Ticker or company name"
          placeholder="Ticker or company name, e.g. AAPL"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={busy !== null}>
          {busy === "search" ? "Searching…" : "Find company"}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {matches && !chosen && (
        matches.length ? (
          <ul className="matches">
            {matches.map((m) => (
              <li key={m.cik + m.ticker}>
                <button className="match" onClick={() => choose(m)}>
                  <strong>{m.ticker}</strong> {m.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No US-listed company matches “{query}”.</p>
        )
      )}

      {chosen && busy === "profile" && <p className="muted">Loading filings for {chosen.name}…</p>}

      {profile && (
        <section className="confirm">
          <h2>
            {profile.name} <span className="muted">({chosen?.ticker})</span>
          </h2>
          <p className="muted">
            CIK {profile.cik}
            {profile.sicDescription && ` · ${profile.sicDescription}`}
          </p>
          {profile.supported ? (
            <>
              <p>
                {profile.annualReports.length
                  ? "The model will use figures from these annual reports:"
                  : "SEC's recent filings list shows no 10-K; the model will use the annual XBRL data SEC holds for this company."}
              </p>
              <table className="filings">
                <thead>
                  <tr>
                    <th>Form</th>
                    <th>Fiscal year end</th>
                    <th>Filed</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {profile.annualReports.map((f) => (
                    <tr key={f.accessionNumber}>
                      <td>{f.form}</td>
                      <td>{f.periodEnd}</td>
                      <td>{f.filed}</td>
                      <td>
                        <a href={f.url} target="_blank" rel="noreferrer">
                          View filing
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">
                Older years come from the comparative columns of these reports, which include
                restated figures.
              </p>
              <div className="actions">
                <button onClick={build} disabled={busy !== null}>
                  {busy === "build" ? "Building model…" : "Build model"}
                </button>
                <button className="secondary" onClick={() => setChosen(null)} disabled={busy !== null}>
                  Choose another company
                </button>
              </div>
            </>
          ) : (
            <p className="error">{profile.unsupportedReason}</p>
          )}
        </section>
      )}
    </main>
  );
}
