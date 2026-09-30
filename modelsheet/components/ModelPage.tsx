"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ModelState } from "@/lib/models/types";
import { Workbench } from "./Workbench";

export function ModelPage({ id }: { id: string }) {
  const [state, setState] = useState<ModelState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.loadModel(id).then(setState, (err: Error) => setError(err.message));
  }, [id]);

  if (error) {
    return (
      <main className="picker">
        <p className="error">{error}</p>
        <Link href="/">Back to your models</Link>
      </main>
    );
  }
  if (!state) return <main className="picker muted">Loading model…</main>;
  return <Workbench initial={state} />;
}
