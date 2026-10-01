import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Queryable } from "../db";
import { hit, LIMITS } from "./ratelimit";

// Guest sessions: a signed cookie holding a user id. Anyone can build a
// model before signing in (a PRD open question, answered "yes" here), and
// models, limits and metrics still attach to a stable user.

export const SESSION_COOKIE = "ms_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEV_SECRET = "dev-only-insecure-session-secret-change-me";

export class SessionConfigError extends Error {}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") {
    throw new SessionConfigError("SESSION_SECRET must be set to at least 32 random characters.");
  }
  return DEV_SECRET;
}

function mac(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("base64url");
}

export function signSession(userId: string): string {
  return `${userId}.${mac(userId)}`;
}

/** The user id in a session token, or null if it was not signed by us. */
export function verifySession(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  const userId = token.slice(0, dot);
  if (dot < 0 || !UUID_RE.test(userId)) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(userId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function sessionCookie(userId: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${signSession(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure}`;
}

/** Caller's IP as reported by the hosting proxy. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

export type SessionResult =
  | { userId: string; setCookie?: string }
  | { userId: null; reason: "none" | "rate_limited" };

export async function resolveSession(
  db: Queryable,
  request: Request,
  options: { create: boolean },
): Promise<SessionResult> {
  const userId = verifySession(readCookie(request, SESSION_COOKIE));
  if (userId) {
    // Recreates the row if the database was reset; refreshes last_seen_at
    // at most hourly to keep writes down.
    await db.query(
      `INSERT INTO users (id) VALUES ($1)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = now()
       WHERE users.last_seen_at < now() - interval '1 hour'`,
      [userId],
    );
    return { userId };
  }
  if (!options.create) return { userId: null, reason: "none" };

  // Clearing cookies would otherwise reset every per-user limit.
  const limit = await hit(db, `new-user:${clientIp(request)}`, LIMITS.newUsersPerIpHour, 3600);
  if (!limit.ok) return { userId: null, reason: "rate_limited" };

  const id = randomUUID();
  await db.query("INSERT INTO users (id) VALUES ($1)", [id]);
  return { userId: id, setCookie: sessionCookie(id) };
}
