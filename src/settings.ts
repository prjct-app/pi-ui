import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The parts of the interface pi-ui can switch off. Each is on unless the person turned it off. */
export const PARTS = ["header", "transcript", "activity", "footer"] as const;
export type Part = (typeof PARTS)[number];
export type UiSettings = Record<Part, boolean>;

export const DEFAULTS: UiSettings = { header: true, transcript: true, activity: true, footer: true };

export function settingsPath(): string {
	return join(process.env.PRJCT_HOME ?? join(homedir(), ".prjct"), "pi-ui", "settings.json");
}

/** Read the switches. A missing or unreadable file means every part is on. */
export function readSettings(path = settingsPath()): UiSettings {
	try {
		const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<Record<Part, unknown>>;
		return Object.fromEntries(PARTS.map((part) => [part, typeof saved[part] === "boolean" ? saved[part] : DEFAULTS[part]])) as UiSettings;
	} catch {
		return { ...DEFAULTS };
	}
}

export function writeSettings(settings: UiSettings, path = settingsPath()): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
	renameSync(temporary, path);
}
