import { SecConfigError, SecRequestError } from "./sec/client";

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Maps SEC failures to responses the UI can show as-is. */
export function secErrorResponse(err: unknown, notFound: string): Response {
  if (err instanceof SecConfigError) return jsonError(err.message, 500);
  if (err instanceof SecRequestError) {
    if (err.status === 404) return jsonError(notFound, 404);
    return jsonError("SEC EDGAR is not responding right now. Try again in a minute.", 502);
  }
  console.error(err);
  return jsonError("Something went wrong while reading SEC data.", 500);
}
