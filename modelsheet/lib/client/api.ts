import type { ModelState, ModelSummary } from "../models/types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const post = <T>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });

export const api = {
  listModels: () => request<{ models: ModelSummary[] }>("/api/models"),
  createModel: (cik: string, ticker: string) => post<{ id: string }>("/api/models", { cik, ticker }),
  loadModel: (id: string) => request<ModelState>(`/api/models/${id}`),
  deleteModel: (id: string) => request<void>(`/api/models/${id}`, { method: "DELETE" }),
  saveEdit: (id: string, baseVersion: number, sheet: string, cell: string, input: string) =>
    post<ModelState>(`/api/models/${id}/edits`, { baseVersion, edits: [{ sheet, cell, input }] }),
  undo: (id: string, baseVersion: number) => post<ModelState>(`/api/models/${id}/undo`, { baseVersion }),
  ask: (id: string, message: string) => post<ModelState>(`/api/models/${id}/agent`, { message }),
  decide: (id: string, proposalId: string, decision: "accept" | "reject") =>
    post<ModelState>(`/api/models/${id}/proposals/${proposalId}`, { decision }),
  exportUrl: (id: string) => `/api/models/${id}/export`,
};
