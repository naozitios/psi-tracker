import { z } from "zod";
import { DbConfigError, getDb, type Db } from "../db";
import { EditRejected, ModelNotFound, VersionConflict } from "../models/store";
import { SecConfigError, SecRequestError } from "../sec/client";
import { resolveSession, SessionConfigError } from "./session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export function tooMany(message: string, retryAfter: number): HttpError {
  return new HttpError(429, message, { retryAfter });
}

/** Parses and validates a JSON body; a bad body is a 400, never a crash. */
export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64_000) throw new HttpError(413, "Request is too large.");
  const text = await request.text();
  if (text.length > 64_000) throw new HttpError(413, "Request is too large.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `Invalid request: ${issue.path.join(".") || "body"} ${issue.message}`);
  }
  return parsed.data;
}

function toResponse(err: unknown): Response {
  if (err instanceof HttpError) return jsonError(err.message, err.status, err.extra);
  if (err instanceof ModelNotFound) return jsonError(err.message, 404);
  if (err instanceof VersionConflict) return jsonError(err.message, 409, { version: err.current });
  if (err instanceof EditRejected) return jsonError(err.message, 400, { reasons: err.reasons });
  if (err instanceof SecConfigError || err instanceof DbConfigError || err instanceof SessionConfigError) {
    console.error(err);
    return jsonError("The server is not configured correctly.", 500);
  }
  if (err instanceof SecRequestError) {
    if (err.status === 404) return jsonError("SEC has no data for this company.", 404);
    return jsonError("SEC EDGAR is not responding right now. Try again in a minute.", 502);
  }
  console.error(err);
  return jsonError("Something went wrong. Try again.", 500);
}

export interface RouteContext {
  db: Db;
  userId: string;
}

/**
 * Runs a handler for the caller's session. `create` starts a guest session
 * when there is none; otherwise the request is refused.
 */
export async function withUser(
  request: Request,
  options: { create: boolean; whenAnonymous?: () => Response },
  handler: (ctx: RouteContext) => Promise<Response>,
): Promise<Response> {
  try {
    const db = await getDb();
    const session = await resolveSession(db, request, options);
    if (session.userId === null) {
      if (session.reason === "rate_limited") {
        return jsonError("Too many new sessions from this network. Try again later.", 429);
      }
      return options.whenAnonymous?.() ?? jsonError("Your session has expired. Reload the page to start a new one.", 401);
    }
    const response = await handler({ db, userId: session.userId });
    if (!session.setCookie) return response;
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", session.setCookie);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (err) {
    return toResponse(err);
  }
}

/** Same error handling for routes that need no session. */
export async function handle(fn: (db: Db) => Promise<Response>): Promise<Response> {
  try {
    return await fn(await getDb());
  } catch (err) {
    return toResponse(err);
  }
}
