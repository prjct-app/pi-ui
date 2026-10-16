import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, parseLibrary, writePrivate, type Library } from "./library.ts";

/**
 * Optional sync with pi-themes. Runs when the person types /palette login, sync,
 * logout, backup or backups, and for the weekly backup while this Pi is
 * connected; without a token the extension never reaches the network. It talks
 * to the site's API only (never to the database), with a token that can read and
 * write this person's palette library and nothing else.
 */
export const SITE = (process.env.PI_THEMES_URL ?? "https://palette.prjct.app").replace(/\/+$/, "");
export const AUTH_PATH = join(DATA_DIR, "auth.json");
const TIMEOUT_MS = 15_000;
const VERSION = "0.4.1";

export type Auth = { token: string; username?: string; site: string; connectedAt: string };

/** Tokens only travel over HTTPS (plain HTTP is allowed for localhost while developing). */
export function assertSecureSite(site = SITE): URL {
	const url = new URL(site);
	const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		throw new Error(`Refusing to send credentials to ${url.origin}: use https`);
	}
	return url;
}

export function readAuth(path = AUTH_PATH): Auth | undefined {
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as Partial<Auth>;
		if (typeof data.token !== "string" || !/^pit_[0-9a-f]{64}$/.test(data.token)) return undefined;
		return { token: data.token, username: data.username, site: data.site ?? SITE, connectedAt: data.connectedAt ?? "" };
	} catch {
		return undefined;
	}
}

export function writeAuth(auth: Auth, path = AUTH_PATH): void {
	writePrivate(path, `${JSON.stringify(auth, null, "\t")}\n`);
}

export function forgetAuth(path = AUTH_PATH): void {
	rmSync(path, { force: true });
}

class ApiError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function api<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
	const base = assertSecureSite();
	const res = await fetch(new URL(path, base), {
		method: init.method ?? "GET",
		headers: {
			"content-type": "application/json",
			"user-agent": `pi-palette/${VERSION}`,
			...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
		redirect: "error",
	});
	const text = await res.text();
	const data: unknown = parseJsonOr(text, {});
	if (!res.ok) {
		const message = typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : `HTTP ${res.status}`;
		throw new ApiError(res.status, message);
	}
	return data as T;
}

/** JSON from the site, or the fallback when the body is empty or not JSON. */
function parseJsonOr(text: string, fallback: unknown): unknown {
	try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
}

export type LinkStart = { code: string; poll: string; url: string; expiresAt: string };
export type LinkClaim = { status: "pending" | "expired" | "invalid" } | { status: "ok"; token: string; username?: string };

export const startLink = (client: string) => api<LinkStart>("/api/pi/link", { method: "POST", body: { client } });
export const claimLink = (poll: string) => api<LinkClaim>("/api/pi/link/claim", { method: "POST", body: { poll } });

/** Pull the person's library from the site. */
export async function pullLibrary(token: string): Promise<Library & { user?: string }> {
	const data = await api<unknown>("/api/pi/library", { token });
	const library = parseLibrary(JSON.stringify(data));
	const user = typeof (data as { user?: unknown }).user === "string" ? (data as { user: string }).user : undefined;
	return { ...library, ...(user ? { user } : {}) };
}

/** Push local palettes and favorites; the site keeps what it already has. */
export const pushLibrary = (token: string, library: Library) =>
	api<{ saved: number; liked: number }>("/api/pi/library", { method: "PUT", token, body: library });

export const revokeToken = (token: string) => api<{ ok: boolean }>("/api/pi/token", { method: "DELETE", token });

/** One version of the library kept on pi-themes. */
export type CloudVersion = { id: string; createdAt: string; client?: string; palettes: number; favorites: number };

/** Save a version on pi-themes; it keeps the last 10 and skips one identical to the newest. */
export const pushBackup = (token: string, library: Library, client: string) =>
	api<{ id?: string; createdAt?: string; skipped?: boolean; count: number }>("/api/pi/backups", { method: "POST", token, body: { client, library } });

/** The versions kept on pi-themes, newest first. */
export async function listBackups(token: string): Promise<CloudVersion[]> {
	const data = await api<{ backups?: unknown }>("/api/pi/backups", { token });
	if (!Array.isArray(data.backups)) return [];
	return data.backups.flatMap((b): CloudVersion[] => {
		if (!b || typeof b !== "object") return [];
		const r = b as Record<string, unknown>;
		if (typeof r.id !== "string" || !/^[0-9a-f-]{36}$/.test(r.id) || typeof r.createdAt !== "string") return [];
		const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
		return [{
			id: r.id,
			createdAt: r.createdAt,
			...(typeof r.client === "string" ? { client: r.client.slice(0, 60) } : {}),
			palettes: count(r.palettes),
			favorites: count(r.favorites),
		}];
	});
}

/** One version's library, cleaned like any library from outside. */
export async function getBackup(token: string, id: string): Promise<Library> {
	if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("bad backup id");
	return parseLibrary(JSON.stringify(await api<unknown>(`/api/pi/backups/${id}`, { token })));
}

export const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;
/** The site has no backups API (an older deployment). */
export const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;
