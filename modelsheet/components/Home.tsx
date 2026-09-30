"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ModelSummary } from "@/lib/models/types";
import { CompanyPicker } from "./CompanyPicker";

export function Home() {
  const router = useRouter();
  const [models, setModels] = useState<ModelSummary[] | null>(null);

  useEffect(() => {
    api
      .listModels()
      .then((data) => setModels(data.models))
      .catch(() => setModels(null));
  }, []);

  async function remove(model: ModelSummary) {
    if (!window.confirm(`Delete the ${model.ticker} model? This cannot be undone.`)) return;
    await api.deleteModel(model.id);
    setModels((list) => list?.filter((m) => m.id !== model.id) ?? null);
  }

  return (
    <>
      <CompanyPicker onBuilt={(id) => router.push(`/models/${id}`)} />
      {models && models.length > 0 && (
        <section className="picker saved">
          <h2>Your models</h2>
          <ul className="matches">
            {models.map((m) => (
              <li key={m.id} className="saved-row">
                <Link className="match" href={`/models/${m.id}`}>
                  <strong>{m.ticker}</strong> {m.companyName}{" "}
                  <span className="muted small">· updated {new Date(m.updatedAt).toLocaleDateString()}</span>
                </Link>
                <button className="link small" onClick={() => remove(m)} aria-label={`Delete ${m.ticker} model`}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
