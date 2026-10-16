import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, writePrivate } from "./library.ts";
import { PALETTE_IDS } from "./palettes.ts";

const FAVORITES_PATH = join(DATA_DIR, "palette-favorites.json");
const knownIds = new Set(PALETTE_IDS);

const missing = Symbol("missing");

/** The parsed file, or `missing` when there is no file. Other read errors propagate. */
function readJsonFile(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return missing;
		throw error;
	}
}

export function readFavorites(path = FAVORITES_PATH): Set<string> {
	const data = readJsonFile(path);
	if (data === missing) return new Set();
	if (!Array.isArray(data) || !data.every((id: unknown) => typeof id === "string")) {
		throw new Error("Invalid palette favorites file");
	}
	return new Set(data.filter((id: string) => knownIds.has(id)));
}

/** Replace the favorites with `ids` (kept in order, duplicates dropped). */
export function writeFavorites(ids: Iterable<string>, path = FAVORITES_PATH): Set<string> {
	const favorites = new Set(ids);
	writePrivate(path, `${JSON.stringify([...favorites])}\n`);
	return favorites;
}

export function toggleFavorite(id: string, path = FAVORITES_PATH): Set<string> {
	if (!knownIds.has(id)) throw new Error(`Unknown palette: ${id}`);
	const favorites = [...readFavorites(path)];
	return writeFavorites(favorites.includes(id) ? favorites.filter((saved) => saved !== id) : [...favorites, id], path);
}
