import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR, parseLibrary, writePrivate, type Library } from "./library.ts";

/**
 * Versioned backups of the person's palette library. Once a week (or when they
 * ask) the library on this computer is saved here and, when the Pi is
 * connected, to pi-themes too; what pi-themes holds is saved here as well.
 * Each side keeps the last KEEP versions. Without an account it is all local.
 */
export const BACKUP_DIR = join(DATA_DIR, "backups");
export const STATE_PATH = join(DATA_DIR, "backup.json");
const LOCK_PATH = join(DATA_DIR, "backup.lock");
export const KEEP = 10;
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** A lock older than this was left by a Pi that died mid-backup. */
const STALE_LOCK_MS = 10 * 60 * 1000;

export type BackupReason = "weekly" | "manual" | "connect" | "restore";

/** One local version: the library on this computer and, when connected, what pi-themes held. */
export type Version = {
	format: "pi-palette-backup";
	version: 1;
	createdAt: string;
	reason: BackupReason;
	hash: { local: string; cloud?: string };
	local: Library;
	cloud?: Library;
	user?: string;
};

/** What the list shows, without the palettes themselves. */
export type VersionInfo = {
	file: string;
	createdAt: string;
	reason: BackupReason;
	palettes: string[];
	favorites: number;
	active?: string;
	cloudPalettes?: number;
	user?: string;
};

export type BackupState = {
	/** The last run, done or skipped because nothing changed: the weekly clock. */
	checkedAt?: number;
	/** The last time the cloud confirmed it holds the current library. */
	cloudAt?: number;
	cloudCount?: number;
	/** Why the cloud part of the last run failed; cleared when it works. */
	cloudError?: string;
};

/** The cloud side, injected so the backup works (and is tested) without a network. */
export type CloudSide = {
	pull(): Promise<Library & { user?: string }>;
	push(library: Library): Promise<{ count: number }>;
};

export type BackupResult = {
	/** False when nothing changed since the newest version. */
	written: boolean;
	file?: string;
	localCount: number;
	cloudCount?: number;
	cloudError?: string;
	/** The cloud said the token is no longer valid. */
	unauthorized?: boolean;
};

const REASONS = new Set<BackupReason>(["weekly", "manual", "connect", "restore"]);
const FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

/** JSON with sorted keys, so the same library always hashes the same. */
function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** What a library holds, ignoring when it was exported. */
export function hashLibrary(library: Library): string {
	const { exportedAt: _ignored, ...content } = library;
	return createHash("sha256").update(stable(content)).digest("hex");
}

export function readState(path = STATE_PATH): BackupState {
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
		return {
			checkedAt: num(data.checkedAt),
			cloudAt: num(data.cloudAt),
			cloudCount: num(data.cloudCount),
			cloudError: typeof data.cloudError === "string" ? data.cloudError.slice(0, 200) : undefined,
		};
	} catch {
		return {};
	}
}

function writeState(state: BackupState, path: string): void {
	writePrivate(path, `${JSON.stringify(state, null, "\t")}\n`);
}

/** True when a week passed since the last run (or there was none). */
export function isDue(state: BackupState, now = Date.now()): boolean {
	return state.checkedAt === undefined || now - state.checkedAt >= WEEK_MS || state.checkedAt > now;
}

/** A version from disk, validated like any library from outside. */
export function readVersion(file: string, dir = BACKUP_DIR): Version {
	if (!FILE.test(file)) throw new Error("not a backup file");
	const data = JSON.parse(readFileSync(join(dir, file), "utf8")) as Record<string, unknown>;
	if (data.format !== "pi-palette-backup") throw new Error("not a palette backup");
	const local = parseLibrary(JSON.stringify(data.local));
	const cloud = data.cloud ? parseLibrary(JSON.stringify(data.cloud)) : undefined;
	const reason = REASONS.has(data.reason as BackupReason) ? data.reason as BackupReason : "weekly";
	const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
	return {
		format: "pi-palette-backup",
		version: 1,
		createdAt,
		reason,
		hash: { local: hashLibrary(local), ...(cloud ? { cloud: hashLibrary(cloud) } : {}) },
		local,
		...(cloud ? { cloud } : {}),
		...(typeof data.user === "string" ? { user: data.user.slice(0, 40) } : {}),
	};
}

/** Local versions, newest first. Unreadable files are skipped. */
export function listVersions(dir = BACKUP_DIR): VersionInfo[] {
	const files = listFiles(dir);
	if (!files) return [];
	const out: VersionInfo[] = [];
	for (const file of files.sort().reverse()) {
		try {
			const v = readVersion(file, dir);
			out.push({
				file,
				createdAt: v.createdAt,
				reason: v.reason,
				palettes: v.local.palettes.map((p) => p.label),
				favorites: v.local.favorites?.length ?? 0,
				...(v.local.active ? { active: v.local.active } : {}),
				...(v.cloud ? { cloudPalettes: v.cloud.palettes.length } : {}),
				...(v.user ? { user: v.user } : {}),
			});
		} catch { /* a damaged file is not a version */ }
	}
	return out;
}

/** Keep the newest `keep` versions, delete the rest. */
function prune(dir: string, keep: number): void {
	const files = readdirSync(dir).filter((f) => FILE.test(f)).sort().reverse();
	for (const file of files.slice(keep)) {
		try { unlinkSync(join(dir, file)); } catch { /* already gone */ }
	}
}

const fileFor = (date: Date) => `${date.toISOString().replace(/[:.]/g, "-")}.json`;
const dateOf = (file: string) => new Date(file.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json$/, "T$1:$2:$3.$4Z"));

/** Save a version unless it holds the same as the newest one. Returns the file, or undefined when skipped. */
export function writeVersion(version: Version, dir = BACKUP_DIR, keep = KEEP): string | undefined {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const newest = listVersions(dir)[0];
	if (newest) {
		const previous = readVersion(newest.file, dir);
		const sameLocal = previous.hash.local === version.hash.local;
		// A run that could not reach the cloud keeps the cloud copy the newest version already has.
		const sameCloud = !version.hash.cloud || previous.hash.cloud === version.hash.cloud;
		if (sameLocal && sameCloud) return undefined;
	}
	const date = new Date(version.createdAt);
	const first = fileFor(Number.isNaN(date.getTime()) ? new Date() : date);
	// Newest stays last even within one millisecond, or when the clock went back.
	const file = newest && first <= newest.file ? fileFor(new Date(dateOf(newest.file).getTime() + 1)) : first;
	writePrivate(join(dir, file), `${JSON.stringify(version, null, "\t")}\n`);
	prune(dir, keep);
	return file;
}

function listFiles(dir: string): string[] | undefined {
	try { return readdirSync(dir).filter((f) => FILE.test(f)); } catch { return undefined; }
}

/** Opens the lock file, taking over a lock left by a Pi that died; undefined when another Pi holds it. */
function acquireLock(path: string): number | undefined {
	try {
		return openSync(path, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		const age = lockAge(path);
		if (age < STALE_LOCK_MS) return undefined;
		rmSync(path, { force: true });
		try { return openSync(path, "wx", 0o600); } catch { return undefined; }
	}
}

function lockAge(path: string): number {
	try { return Date.now() - statSync(path).mtimeMs; } catch { return 0; /* just released */ }
}

/** Run `fn` unless another Pi is backing up right now. */
async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T | undefined> {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const fd = acquireLock(path);
	if (fd === undefined) return undefined;
	try {
		writeSync(fd, String(process.pid));
		return await fn();
	} finally {
		closeSync(fd);
		rmSync(path, { force: true });
	}
}

/**
 * Save the library as it is right now, before a restore replaces it, so a
 * restore can itself be undone. Local only; the weekly clock is not touched.
 */
export async function saveBeforeRestore(local: Library, options: { now?: Date; dir?: string; lockPath?: string; keep?: number } = {}): Promise<string | undefined> {
	const { exportedAt: _ignored, ...content } = local;
	return withLock(options.lockPath ?? LOCK_PATH, async () => writeVersion({
		format: "pi-palette-backup",
		version: 1,
		createdAt: (options.now ?? new Date()).toISOString(),
		reason: "restore",
		hash: { local: hashLibrary(content) },
		local: content,
	}, options.dir ?? BACKUP_DIR, options.keep ?? KEEP));
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type BackupOptions = {
	local: Library;
	cloud?: CloudSide;
	reason: BackupReason;
	isUnauthorized?: (error: unknown) => boolean;
	now?: Date;
	dir?: string;
	statePath?: string;
	lockPath?: string;
	keep?: number;
};

/**
 * One backup run: bring what the cloud holds, send this library up, and save
 * a local version of both. The local part always runs; a cloud failure is
 * reported, never thrown. Returns undefined when another Pi is already on it.
 */
export async function runBackup(options: BackupOptions): Promise<BackupResult | undefined> {
	const dir = options.dir ?? BACKUP_DIR;
	const statePath = options.statePath ?? STATE_PATH;
	const now = options.now ?? new Date();
	return withLock(options.lockPath ?? LOCK_PATH, async () => {
		const state = readState(statePath);
		const { exportedAt: _ignored, ...local } = options.local;
		const sync = {
			cloud: undefined as (Library & { user?: string }) | undefined,
			cloudCount: undefined as number | undefined,
			cloudError: undefined as string | undefined,
			unauthorized: false,
		};
		if (options.cloud) {
			try {
				// Pull first: the copy saved here is the cloud as it was before this push.
				sync.cloud = await options.cloud.pull();
				sync.cloudCount = (await options.cloud.push(local)).count;
			} catch (error) {
				sync.cloudError = message(error);
				sync.unauthorized = options.isUnauthorized?.(error) ?? false;
			}
		}
		const { cloudCount, cloudError, unauthorized } = sync;
		const { user, library: cloudLibrary } = sync.cloud
			? (({ user: pulledUser, ...library }) => ({ user: pulledUser, library: library as Library }))(sync.cloud)
			: { user: undefined, library: undefined };
		const version: Version = {
			format: "pi-palette-backup",
			version: 1,
			createdAt: now.toISOString(),
			reason: options.reason,
			hash: { local: hashLibrary(local), ...(cloudLibrary ? { cloud: hashLibrary(cloudLibrary) } : {}) },
			local,
			...(cloudLibrary ? { cloud: cloudLibrary } : {}),
			...(user ? { user } : {}),
		};
		const file = writeVersion(version, dir, options.keep ?? KEEP);
		const next: BackupState = { ...state, checkedAt: now.getTime() };
		if (options.cloud && cloudCount !== undefined) {
			next.cloudAt = now.getTime();
			next.cloudCount = cloudCount;
			delete next.cloudError;
		} else if (options.cloud) {
			next.cloudError = cloudError;
		} else {
			delete next.cloudAt;
			delete next.cloudCount;
			delete next.cloudError;
		}
		writeState(next, statePath);
		return {
			written: file !== undefined,
			...(file ? { file } : {}),
			localCount: listVersions(dir).length,
			...(cloudCount !== undefined ? { cloudCount } : {}),
			...(cloudError ? { cloudError } : {}),
			...(unauthorized ? { unauthorized } : {}),
		};
	});
}
