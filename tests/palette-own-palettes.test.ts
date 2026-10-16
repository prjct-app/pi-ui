import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// A person's library on disk before the extension loads. Palette data lives in ${PRJCT_HOME}/pi-palette.
const agent = mkdtempSync(join(tmpdir(), "pi-palette-agent-"));
const home = mkdtempSync(join(tmpdir(), "pi-palette-home-"));
process.env.PI_CODING_AGENT_DIR = agent;
process.env.PRJCT_HOME = home;
mkdirSync(join(home, "pi-palette"), { recursive: true });
const vars = { canvas: "#101010", text: "#F0F0F0", accent: "#FF8800", secondary: "#00AAFF", highlight: "#FF44AA", success: "#44DD88", warning: "#FFCC00", error: "#FF4455" };
writeFileSync(join(home, "pi-palette", "library.json"), JSON.stringify({
	format: "pi-palette", version: 1,
	palettes: [{ id: "sunrise", label: "Sunrise", vars }, { id: "dracula", label: "My Dracula", vars }],
}));

const { OWN_GROUP, themeCategories, groupOf } = await import("../src/palette/palette-groups.ts");
const { BUNDLED_IDS, findPalette, PALETTES } = await import("../src/palette/palettes.ts");

test("your own palettes get their own group and override bundled ones", () => {
	assert.equal(PALETTES.length, 54);
	assert.equal(findPalette("dracula")?.label, "My Dracula");
	assert.equal(findPalette("sunrise")?.swatches.length, 5);
	assert.equal(groupOf("sunrise"), OWN_GROUP);
	assert.equal(groupOf("dracula"), OWN_GROUP);
	assert.equal(BUNDLED_IDS.includes("sunrise"), false);
	const yours = themeCategories(new Set()).find((c) => c.id === "yours")!;
	assert.equal(yours.label, OWN_GROUP);
	assert.deepEqual(yours.palettes.map((p) => p.id), ["dracula", "sunrise"].sort((a, b) => PALETTES.findIndex((p) => p.id === a) - PALETTES.findIndex((p) => p.id === b)));
	assert.equal(themeCategories(new Set()).find((c) => c.id === "editor")!.palettes.some((p) => p.id === "dracula"), false);
});
