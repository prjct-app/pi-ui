import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Keep the real ~/.pi/agent (and any library in it) out of the test.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-palette-agent-"));
const { readFavorites, toggleFavorite } = await import("../src/palette/favorites.ts");
const { themeCategories } = await import("../src/palette/palette-groups.ts");
const { PALETTES } = await import("../src/palette/palettes.ts");

const ids = (favorites: ReadonlySet<string>, id: string) => themeCategories(favorites).find((c) => c.id === id)!.palettes.map((p) => p.id);

test("every palette lives in exactly one category; favorites are a view on top", () => {
	const categories = themeCategories(new Set());
	assert.deepEqual(categories.map((c) => c.label), ["Favorites", "Your palettes", "Editor classics", "From photos", "Originals"]);
	assert.deepEqual(ids(new Set(), "favorites"), []);
	assert.match(categories[0]!.empty, /press f/);
	assert.deepEqual(ids(new Set(), "photo"), [
		"glacier", "ember", "iris", "hearth", "atelier", "bloom", "tidepool", "orchard",
		"butterfly-nebula", "daphnis", "lagoon-nebula", "saturn-distance", "southern-ring", "stellar-outburst",
		"rho-ophiuchi", "galaxy-pair", "io-volcanoes", "fuji-from-orbit", "ring-nebula", "pillars-of-creation",
		"saturns-rings", "aurora-borealis", "sombrero-galaxy", "earthrise-sunset", "cosmic-cliffs", "cartwheel-galaxy", "jewel-nebula",
	]);
	const homes = categories.filter((c) => c.id !== "favorites").flatMap((c) => c.palettes.map((p) => p.id));
	assert.equal(homes.length, PALETTES.length);
	assert.equal(new Set(homes).size, PALETTES.length);
});

test("favorites show in their own category, stay in theirs, and survive reload", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-palette-favorites-"));
	const path = join(directory, "nested", "favorites.json");
	try {
		assert.deepEqual([...readFavorites(path)], []);
		toggleFavorite("orchard", path);
		const afterTensor = toggleFavorite("tensor", path);
		assert.deepEqual(ids(afterTensor, "favorites"), ["tensor", "orchard"]);
		assert.ok(ids(afterTensor, "photo").includes("orchard"));
		assert.deepEqual([...readFavorites(path)], ["orchard", "tensor"]);
		const afterOrchard = toggleFavorite("orchard", path);
		assert.deepEqual([...afterOrchard], ["tensor"]);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), ["tensor"]);
		assert.throws(() => toggleFavorite("not-a-theme", path), /Unknown palette/);
		writeFileSync(path, "not JSON");
		assert.throws(() => toggleFavorite("tensor", path));
		assert.equal(readFileSync(path, "utf8"), "not JSON");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
