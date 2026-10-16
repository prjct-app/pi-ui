import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Palettes are data. The extension ships palettes.json (the official set) and
 * merges the person's own library on top: a local file they import, export or
 * sync on demand.
 */
export type Swatch = { name: string; hex: string };
export type LibraryPalette = {
	id: string;
	label: string;
	group?: "original" | "editor" | "photo" | "community";
	author?: string;
	swatches?: Swatch[];
	vars: Record<string, string>;
	/** Only the roles that differ from DEFAULT_COLORS. */
	colors?: Record<string, string>;
	/** Pi's HTML export colors, when they differ from DEFAULT_EXPORT. */
	export?: Record<string, string>;
};
export type Library = {
	format: "pi-palette";
	version: 1;
	exportedAt?: string;
	active?: string;
	favorites?: string[];
	palettes: LibraryPalette[];
};

export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
/** Extension data lives outside Pi's folder, at ${PRJCT_HOME:-~/.prjct}/pi-palette. */
export const PRJCT_HOME = process.env.PRJCT_HOME ?? join(homedir(), ".prjct");
export const DATA_DIR = join(PRJCT_HOME, "pi-palette");
export const LIBRARY_PATH = join(DATA_DIR, "library.json");
/**
 * Pi's own themes folder. Pi applies the theme in settings before any extension
 * runs and only looks here then, so the theme files have to live here.
 */
export const THEMES_DIR = join(AGENT_DIR, "themes");
/** The theme files this extension wrote into THEMES_DIR; nothing else there is touched. */
const OWNED_PATH = join(DATA_DIR, "owned-themes.json");
/** Where 0.3.0 generated theme files (too late for the startup theme). */
const LEGACY_THEMES_DIR = join(DATA_DIR, "themes");
const BUNDLED_PATH = join(dirname(fileURLToPath(import.meta.url)), "palettes.json");

/** Every Pi color role, mapped to a theme variable (shared with pi-themes). */
export const DEFAULT_COLORS: Record<string, string> = {
	accent: "accent", border: "border", borderAccent: "accent", borderMuted: "borderMuted",
	success: "success", error: "error", warning: "warning", muted: "muted", dim: "dim", text: "text",
	thinkingText: "textSoft", selectedBg: "selected", userMessageBg: "", userMessageText: "text",
	customMessageBg: "", customMessageText: "text", customMessageLabel: "highlight",
	toolPendingBg: "", toolSuccessBg: "", toolErrorBg: "", toolTitle: "secondary", toolOutput: "textSoft",
	mdHeading: "highlight", mdLink: "accent", mdLinkUrl: "muted", mdCode: "synString", mdCodeBlock: "textSoft",
	mdCodeBlockBorder: "border", mdQuote: "muted", mdQuoteBorder: "secondary", mdHr: "borderMuted", mdListBullet: "highlight",
	syntaxComment: "synComment", syntaxKeyword: "synKeyword", syntaxFunction: "synFunction", syntaxVariable: "synVariable",
	syntaxString: "synString", syntaxNumber: "synNumber", syntaxType: "synType", syntaxOperator: "synOperator",
	syntaxPunctuation: "synPunctuation", scrollbarTrack: "borderMuted", scrollbarThumb: "dim", searchMatchBg: "search",
	searchMatchText: "text", toolDiffAdded: "success", toolDiffRemoved: "error", toolDiffContext: "muted",
	thinkingOff: "borderMuted", thinkingMinimal: "dim", thinkingLow: "secondary", thinkingMedium: "accent",
	thinkingHigh: "warning", thinkingXhigh: "highlight", thinkingMax: "error", bashMode: "bash",
};
/** Pi's theme schema accepts only these HTML export colors; any other key makes the theme invalid. */
export const EXPORT_KEYS = ["pageBg", "cardBg", "infoBg"] as const;
export const DEFAULT_EXPORT: Record<string, string> = {
	pageBg: "canvas", cardBg: "surface", infoBg: "surfaceRaised",
};

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const NAME = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const CORE = ["canvas", "text", "accent", "secondary", "highlight", "success", "warning", "error"];
const GROUPS = new Set(["original", "editor", "photo", "community"]);
const MAX_PALETTES = 500;

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function cleanMap(value: unknown, valid: (v: string) => boolean, keys?: Record<string, string>): Record<string, string> | undefined {
	if (!isObject(value)) return undefined;
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value).slice(0, 80)) {
		if (!NAME.test(k) || typeof v !== "string" || !valid(v)) continue;
		if (keys && !(k in keys)) continue;
		out[k] = HEX.test(v) ? v.toUpperCase() : v;
	}
	return Object.keys(out).length ? out : undefined;
}

/** One palette from untrusted input, or undefined when it is not usable. */
export function cleanPalette(value: unknown): LibraryPalette | undefined {
	if (!isObject(value)) return undefined;
	const id = typeof value.id === "string" ? value.id.toLowerCase() : "";
	if (!ID.test(id)) return undefined;
	const vars = cleanMap(value.vars, (v) => HEX.test(v));
	if (!vars || !CORE.every((k) => vars[k])) return undefined;
	const ref = (v: string) => v === "" || HEX.test(v) || NAME.test(v);
	const colors = cleanMap(value.colors, ref, DEFAULT_COLORS);
	const exported = cleanMap(value.export, ref, DEFAULT_EXPORT);
	const swatches = Array.isArray(value.swatches)
		? value.swatches
			.filter((s): s is Swatch => isObject(s) && typeof s.name === "string" && s.name.length > 0 && s.name.length <= 24 && typeof s.hex === "string" && HEX.test(s.hex))
			.slice(0, 8)
			.map((s) => ({ name: s.name, hex: s.hex.toUpperCase() }))
		: undefined;
	const label = typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, 40) : id;
	const group = typeof value.group === "string" && GROUPS.has(value.group) ? value.group as LibraryPalette["group"] : undefined;
	const author = typeof value.author === "string" && /^[a-z0-9][a-z0-9-]{1,30}$/.test(value.author) ? value.author : undefined;
	return {
		id, label, vars,
		...(group ? { group } : {}),
		...(author ? { author } : {}),
		...(swatches?.length ? { swatches } : {}),
		...(colors ? { colors } : {}),
		...(exported ? { export: exported } : {}),
	};
}

function parseOrThrow(text: string): unknown {
	try { return JSON.parse(text); } catch { throw new Error("not JSON"); }
}

/** The file's text, or undefined when it cannot be read (a new file, or a dangling symlink). */
function readOptionalText(path: string): string | undefined {
	try { return readFileSync(path, "utf8"); } catch { return undefined; }
}

/** Parse a library (or a single Pi theme file) from untrusted text. Throws with a short reason. */
export function parseLibrary(text: string): Library {
	const parsed = parseOrThrow(text);
	if (!isObject(parsed)) throw new Error("not a palette library");
	const data = !Array.isArray(parsed.palettes) && isObject(parsed.vars) && typeof parsed.name === "string"
		? { format: "pi-palette", version: 1, palettes: [{ id: parsed.name, label: parsed.name, vars: parsed.vars, colors: parsed.colors, export: parsed.export }] }
		: parsed;
	const raw = data as Record<string, unknown>;
	if (!Array.isArray(raw.palettes)) throw new Error("not a palette library");
	const seen = new Set<string>();
	const palettes: LibraryPalette[] = [];
	for (const p of raw.palettes.slice(0, MAX_PALETTES)) {
		const clean = cleanPalette(p);
		if (clean && !seen.has(clean.id)) { seen.add(clean.id); palettes.push(clean); }
	}
	const favorites = Array.isArray(raw.favorites)
		? [...new Set(raw.favorites.filter((f): f is string => typeof f === "string" && ID.test(f)))].slice(0, MAX_PALETTES)
		: undefined;
	const active = typeof raw.active === "string" && ID.test(raw.active) ? raw.active : undefined;
	return { format: "pi-palette", version: 1, palettes, ...(favorites ? { favorites } : {}), ...(active ? { active } : {}) };
}

export function readBundled(path = BUNDLED_PATH): Library {
	return parseLibrary(readFileSync(path, "utf8"));
}

/** The person's own library, or undefined when there is none yet. */
export function readUserLibrary(path = LIBRARY_PATH): Library | undefined {
	if (!existsSync(path)) return undefined;
	return parseLibrary(readFileSync(path, "utf8"));
}

/** Write atomically, readable only by this user. */
export function writePrivate(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, text, { mode: 0o600 });
		renameSync(temp, path);
		chmodSync(path, 0o600);
	} catch (error) {
		try { unlinkSync(temp); } catch { /* nothing to clean up */ }
		throw error;
	}
}

export function writeUserLibrary(library: Library, path = LIBRARY_PATH): void {
	writePrivate(path, `${JSON.stringify(library, null, "\t")}\n`);
}

/** Bundled palettes first, then the person's; theirs replace a bundled palette with the same id. */
export function mergePalettes(bundled: LibraryPalette[], own: LibraryPalette[] = []): LibraryPalette[] {
	const mine = new Map(own.map((p) => [p.id, p]));
	const merged = bundled.map((p) => mine.get(p.id) ?? p);
	const bundledIds = new Set(bundled.map((p) => p.id));
	return [...merged, ...own.filter((p) => !bundledIds.has(p.id))];
}

/** The Pi theme file for a palette. Roles that point at a missing variable fall back to the default role. */
export function themeJson(p: LibraryPalette) {
	const resolve = (map: Record<string, string>, base: Record<string, string>) => {
		const out: Record<string, string> = {};
		for (const [role, fallback] of Object.entries(base)) {
			const v = map[role] ?? fallback;
			out[role] = v === "" || HEX.test(v) || v in p.vars ? v : (fallback === "" || fallback in p.vars ? fallback : "text");
		}
		return out;
	};
	// A palette's own export block is used as is (Pi fills in what it leaves out).
	const ownExport = p.export
		? Object.fromEntries(Object.entries(p.export).filter(([k, v]) =>
			(EXPORT_KEYS as readonly string[]).includes(k) && (v === "" || HEX.test(v) || v in p.vars)))
		: undefined;
	return {
		$schema: "https://pi.dev/theme-schema.json",
		name: p.id,
		vars: p.vars,
		colors: resolve({ ...DEFAULT_COLORS, ...p.colors }, DEFAULT_COLORS),
		export: ownExport ?? resolve(DEFAULT_EXPORT, DEFAULT_EXPORT),
	};
}

function readOwned(path: string): Set<string> {
	try {
		const data: unknown = JSON.parse(readFileSync(path, "utf8"));
		return new Set(Array.isArray(data) ? data.filter((f): f is string => typeof f === "string" && /^[a-z0-9][a-z0-9-]*\.json$/.test(f)) : []);
	} catch {
		return new Set();
	}
}

function isLink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

/** Replace a file (or a symlink, never its target) in one step, so Pi's theme watcher never reads half of it. */
function writeAtomic(path: string, text: string): void {
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, text);
		renameSync(temp, path);
	} catch (error) {
		try { unlinkSync(temp); } catch { /* nothing to clean up */ }
		throw error;
	}
}

/**
 * Keep one theme file per palette in `dir`, rewriting only what changed and
 * removing the files this extension wrote for palettes that are gone. A theme
 * of the person's own with the same name is left alone and wins. Returns the
 * paths of the files this extension owns.
 */
export function syncThemeFiles(palettes: LibraryPalette[], dir = THEMES_DIR, ownedPath = OWNED_PATH): string[] {
	mkdirSync(dir, { recursive: true });
	const owned = readOwned(ownedPath);
	const kept = new Set<string>();
	const paths: string[] = [];
	for (const p of palettes) {
		const file = `${p.id}.json`;
		const path = join(dir, file);
		const text = `${JSON.stringify(themeJson(p), null, "\t")}\n`;
		const current = readOptionalText(path);
		if (current !== undefined && current !== text && !owned.has(file)) continue;
		if (current !== text || isLink(path)) writeAtomic(path, text);
		kept.add(file);
		paths.push(path);
	}
	for (const file of owned) {
		if (kept.has(file)) continue;
		try { unlinkSync(join(dir, file)); } catch { /* already gone */ }
	}
	writePrivate(ownedPath, `${JSON.stringify([...kept].sort())}\n`);
	return paths;
}

/** Remove the theme folder 0.3.0 generated, now that the files live in Pi's themes folder. */
export function removeLegacyThemes(dir = LEGACY_THEMES_DIR): void {
	rmSync(dir, { recursive: true, force: true });
}
