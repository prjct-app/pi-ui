import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	unwatchFile,
	watchFile,
	writeFileSync,
	type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "./library.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
export const SYNC_PATH = join(DATA_DIR, "palette-sync.json");
const SETTINGS_PATH = join(agentDir, "settings.json");

type SyncPayload = {
	theme: string;
	at: number;
};

function readJsonTheme(path: string): string | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { theme?: unknown };
		return typeof parsed.theme === "string" && parsed.theme.length > 0 ? parsed.theme : undefined;
	} catch {
		return undefined;
	}
}

function mtime(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}

export function writeActiveTheme(id: string): void {
	mkdirSync(DATA_DIR, { recursive: true });
	const payload: SyncPayload = { theme: id, at: Date.now() };
	const tmp = `${SYNC_PATH}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(payload)}\n`);
	renameSync(tmp, SYNC_PATH);
}

export function readActiveTheme(): string | undefined {
	const synced = readJsonTheme(SYNC_PATH);
	const settings = readJsonTheme(SETTINGS_PATH);
	if (synced && settings && existsSync(SYNC_PATH) && existsSync(SETTINGS_PATH)) {
		return mtime(SETTINGS_PATH) > mtime(SYNC_PATH) + 25 ? settings : synced;
	}
	return synced ?? settings;
}

export function watchActiveTheme(
	onChange: (theme: string) => void,
	interval = 200,
): () => void {
	const watch = { active: true };
	const listener = (current: Stats, previous: Stats): void => {
		if (!watch.active || current.mtimeMs === 0 || current.mtimeMs === previous.mtimeMs) return;
		const theme = readActiveTheme();
		if (theme) onChange(theme);
	};

	watchFile(SYNC_PATH, { interval, persistent: false }, listener);
	return () => {
		watch.active = false;
		unwatchFile(SYNC_PATH, listener);
	};
}
