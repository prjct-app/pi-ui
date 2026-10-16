import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-palette-agent-"));
const { DEFAULT_COLORS, mergePalettes, parseLibrary, readBundled, syncThemeFiles, themeJson, writePrivate } = await import("../src/palette/library.ts");
const { EDITOR_GROUP, PHOTO_GROUP, groupOf } = await import("../src/palette/palette-groups.ts");
const { findPalette, resolvePaletteArg } = await import("../src/palette/palettes.ts");

const HEX = /^#[0-9A-F]{6}$/;

test("the bundled library has 53 complete palettes that make loadable themes", () => {
	const { palettes } = readBundled();
	assert.equal(palettes.length, 53);
	assert.equal(new Set(palettes.map((p) => p.id)).size, 53);
	assert.deepEqual(palettes.filter((p) => p.group === "editor").map((p) => p.id),
		["dracula", "onedark", "tokyonight", "catppuccin", "nightowl", "nord", "monokai", "gruvbox", "claude"]);
	const photoPalettes = palettes.filter((p) => p.group === "photo");
	assert.equal(photoPalettes.length, 27);
	const photoSwatches = photoPalettes.flatMap((p) => p.swatches?.map((swatch) => swatch.hex) ?? []);
	assert.equal(new Set(photoSwatches).size, photoSwatches.length, "photo palettes should not repeat swatch colors");
	for (const p of palettes) {
		const theme = themeJson(p);
		assert.equal(theme.name, p.id);
		assert.deepEqual(Object.keys(theme.colors).sort(), Object.keys(DEFAULT_COLORS).sort());
		for (const ref of [...Object.values(theme.colors), ...Object.values(theme.export)]) {
			assert.ok(ref === "" || HEX.test(ref) || ref in theme.vars, `${p.id}: ${ref}`);
		}
		assert.equal(p.swatches?.length, 5);
		for (const s of p.swatches ?? []) assert.ok(HEX.test(s.hex));
		assert.equal(findPalette(p.id)?.label, p.label);
		assert.equal(resolvePaletteArg(p.id), p.id);
	}
	assert.equal(groupOf("dracula"), EDITOR_GROUP);
	assert.equal(groupOf("glacier"), PHOTO_GROUP);
});

test("libraries from outside are cleaned, never trusted", () => {
	const lib = parseLibrary(JSON.stringify({
		format: "pi-palette",
		active: "mine",
		favorites: ["dracula", "../../etc", "DRACULA", 7],
		palettes: [
			{ id: "mine", label: "  Mine  ", vars: { canvas: "#000000", text: "#ffffff", accent: "#ff0000", secondary: "#00ff00", highlight: "#0000ff", success: "#00ff00", warning: "#ffff00", error: "#ff0000", evil: "url(x)" }, colors: { accent: "secondary", notARole: "accent", bashMode: "<script>" } },
			{ id: "../escape", vars: {} },
			{ id: "nocore", vars: { canvas: "#000000" } },
			{ id: "mine", label: "duplicate", vars: {} },
		],
	}));
	assert.deepEqual(lib.palettes.map((p) => p.id), ["mine"]);
	const mine = lib.palettes[0]!;
	assert.equal(mine.label, "Mine");
	assert.equal(mine.vars.canvas, "#000000");
	assert.equal(mine.vars.text, "#FFFFFF");
	assert.equal("evil" in mine.vars, false);
	assert.deepEqual(mine.colors, { accent: "secondary" });
	assert.deepEqual(lib.favorites, ["dracula"]);
	assert.equal(lib.active, "mine");
	assert.throws(() => parseLibrary("not json"), /not JSON/);
	assert.throws(() => parseLibrary("[]"), /not a palette library/);
	// A plain Pi theme file is a library of one.
	const single = parseLibrary(JSON.stringify({ name: "solo", vars: mine.vars }));
	assert.deepEqual(single.palettes.map((p) => p.id), ["solo"]);
});

test("your palettes replace bundled ones with the same id and add the rest", () => {
	const bundled = readBundled().palettes;
	const own = [{ ...bundled[0]!, label: "Mine now" }, { id: "extra", label: "Extra", vars: bundled[1]!.vars }];
	const merged = mergePalettes(bundled, own);
	assert.equal(merged.length, 54);
	assert.equal(merged[0]!.label, "Mine now");
	assert.equal(merged.at(-1)!.id, "extra");
});

test("theme files follow the palettes: written once, rewritten when changed, removed when gone", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-palette-themes-"));
	const owned = join(dir, "..", `${dir.split("/").pop()}-owned.json`);
	try {
		const palettes = readBundled().palettes.slice(0, 3);
		const paths = syncThemeFiles(palettes, dir, owned);
		assert.equal(paths.length, 3);
		const first = statSync(paths[0]!).mtimeMs;
		syncThemeFiles(palettes.slice(0, 2), dir, owned);
		assert.deepEqual(readdirSync(dir).sort(), palettes.slice(0, 2).map((p) => `${p.id}.json`).sort());
		assert.equal(statSync(paths[0]!).mtimeMs, first);
		assert.equal(JSON.parse(readFileSync(paths[0]!, "utf8")).name, palettes[0]!.id);
		const changed = { ...palettes[0]!, vars: { ...palettes[0]!.vars, accent: "#123456" } };
		syncThemeFiles([changed, palettes[1]!], dir, owned);
		assert.equal(JSON.parse(readFileSync(paths[0]!, "utf8")).vars.accent, "#123456");
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(owned, { force: true });
	}
});

test("theme files share Pi's themes folder: the person's own themes are never touched", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-palette-themes-"));
	const owned = join(dir, "..", `${dir.split("/").pop()}-owned.json`);
	try {
		const [a, b, c] = readBundled().palettes;
		// Their own theme, a theme with a palette's name, and a link an older extension left to nothing.
		writeFileSync(join(dir, "mine.json"), "{}");
		writeFileSync(join(dir, `${b!.id}.json`), '{"name":"theirs"}');
		symlinkSync(join(dir, "gone", `${c!.id}.json`), join(dir, `${c!.id}.json`));
		const paths = syncThemeFiles([a!, b!, c!], dir, owned);
		assert.deepEqual(paths.map((p) => p.split("/").pop()), [`${a!.id}.json`, `${c!.id}.json`]);
		assert.equal(readFileSync(join(dir, "mine.json"), "utf8"), "{}");
		assert.equal(JSON.parse(readFileSync(join(dir, `${b!.id}.json`), "utf8")).name, "theirs");
		assert.equal(lstatSync(join(dir, `${c!.id}.json`)).isSymbolicLink(), false);
		assert.equal(JSON.parse(readFileSync(join(dir, `${c!.id}.json`), "utf8")).name, c!.id);
		// Palettes that are gone take only their own files with them.
		syncThemeFiles([], dir, owned);
		assert.deepEqual(readdirSync(dir).sort(), ["mine.json", `${b!.id}.json`].sort());
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(owned, { force: true });
	}
});

test("private files are readable only by their owner", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-palette-private-"));
	try {
		const path = join(dir, "nested", "auth.json");
		writePrivate(path, "{}");
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.equal(statSync(join(dir, "nested")).mode & 0o777, 0o700);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
