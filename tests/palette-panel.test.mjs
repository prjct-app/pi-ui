import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-palette-agent-"));
const { openPalettePanels } = await import("../src/palette/palette-panel.ts");

const theme = { fg: (_color, text) => text, bold: (text) => text };
const KEY = { up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", enter: "\r", esc: "\x1b" };

/** Open the picker, run `script(panel, screen)` and return what it handed back and the theme left on. */
function drive(script, host, initial, width = 120) {
	const ui = {
		theme: { name: "orchard" },
		setTheme(name) { this.theme.name = name; return { success: true }; },
		custom(factory) {
			return new Promise((done) => {
				const panel = factory({ terminal: { rows: 30 }, requestRender() {} }, theme, undefined, done);
				const screen = () => panel.render(width).join("\n");
				script(panel, screen, ui);
			});
		},
	};
	return openPalettePanels({ ui }, host, initial).then((result) => ({ result, theme: ui.theme.name }));
}

const connectedHost = (calls = []) => ({
	info: () => ({ connected: true, account: "@jj on palette.prjct.app", backups: "3h ago · 1 local · 1 cloud" }),
	backups: () => ({
		local: [{ file: "2026-10-03T15-52-38-587Z.json", createdAt: "2026-10-03T15:52:38.587Z", reason: "weekly", palettes: ["Sunrise"], favorites: 0 }],
		cloud: [{ id: "52d37c17-5315-44e8-8715-e97e0226e82d", createdAt: "2026-10-03T16:02:44Z", client: "Pi · darwin", palettes: 1, favorites: 0 }],
		summary: "1/10 local · 1/10 cloud · next check in 7d",
	}),
	readBackup: () => ({ createdAt: "2026-10-03T15:52:38.587Z", reason: "weekly", local: { palettes: [{ id: "sunrise", label: "Sunrise" }], favorites: [] }, hash: { local: "x" } }),
	refreshCloud: async () => { calls.push("refresh"); },
	backupNow: async () => { calls.push("backup"); return { text: "Backed up.", tone: "success" }; },
	site: "palette.prjct.app",
});

test("renders at narrow and wide widths, at both levels", async () => {
	await drive((panel) => {
		for (const width of [18, 50, 100]) assert.ok(panel.render(width).some((line) => line.includes("Palette")));
		panel.handleInput(KEY.right);
		for (const width of [18, 50, 100]) assert.ok(panel.render(width).length > 0);
		panel.handleInput("\t");
		assert.ok(panel.render(50).length > 0);
		panel.handleInput("q");
		panel.handleInput("q");
	});
});

test("categories on the left, the highlighted one's list on the right; opening shows details and its keys", async () => {
	const { result, theme: left } = await drive((panel, screen, ui) => {
		// Opens on the category of the theme in use (Orchard is from photos).
		const s = { value: screen() };
		assert.match(s.value, /› From photos/);
		assert.match(s.value, /Backups/);
		assert.match(s.value, /Account/);
		assert.match(s.value, /Colors taken from photographs/);
		assert.match(s.value, /Glacier/);
		assert.match(s.value, /↑↓ category · → open · esc close/);
		panel.handleInput(KEY.right);
		s.value = screen();
		assert.match(s.value, /‹ From photos/);
		assert.match(s.value, /Live preview/);
		assert.match(s.value, /f favorite · a apply/);
		assert.match(s.value, /↑↓ preview · ← categories · esc back/);
		panel.handleInput(KEY.up); // Orchard is the last one from photos
		assert.match(screen(), /Tidepool[\s\S]*Live preview/);
		assert.equal(ui.theme.name, "tidepool", "moving previews");
		panel.handleInput(KEY.left);
		panel.handleInput(KEY.esc);
	});
	assert.equal(result, undefined);
	assert.equal(left, "orchard", "leaving restores the theme in use");
});

test("applying a previewed palette", async () => {
	const { result, theme: applied } = await drive((panel) => {
		panel.handleInput(KEY.right);
		panel.handleInput(KEY.up);
		panel.handleInput("a");
	});
	assert.ok(result.apply);
	assert.equal(applied, result.apply);
});

test("backups bring their own keys: back up now, restore on the second r", async () => {
	const calls = [];
	const { result } = await drive(async (panel, screen) => {
		const s = { value: screen() };
		assert.match(s.value, /‹ Backups/, "/palette backups opens straight into the list");
		assert.match(s.value, /b back up now · r restore/);
		assert.match(s.value, /On this computer/);
		panel.handleInput("b");
		await new Promise((r) => setTimeout(r, 10));
		assert.match(screen(), /Backed up\./);
		panel.handleInput(KEY.down);
		assert.match(screen(), /On palette\.prjct\.app/);
		panel.handleInput("r");
		assert.match(screen(), /Press r again to restore/);
		panel.handleInput("r");
	}, connectedHost(calls), "backups");
	assert.deepEqual(result, { restore: "cloud:52d37c17-5315-44e8-8715-e97e0226e82d" });
	assert.ok(calls.includes("backup"));
	assert.equal(calls.filter((c) => c === "refresh").length >= 1, true);
});

test("another key cancels a restore; account runs its actions", async () => {
	const { result } = await drive((panel, screen) => {
		panel.handleInput("r");
		panel.handleInput(KEY.down);
		panel.handleInput("r");
		panel.handleInput("j");
		assert.doesNotMatch(screen(), /Press r again/);
		panel.handleInput(KEY.left);
		panel.handleInput(KEY.down);
		const s = { value: screen() };
		assert.match(s.value, /› Account/);
		assert.match(s.value, /@jj on palette\.prjct\.app/);
		assert.match(s.value, /s sync · l log out · i import · e export/);
		panel.handleInput(KEY.right);
		assert.match(screen(), /Sends your palettes and favorites/);
		panel.handleInput(KEY.enter);
	}, connectedHost(), "backups");
	assert.deepEqual(result, { action: "sync" });
	for (const [key, action] of [["l", "logout"], ["i", "import"], ["e", "export"]]) {
		const r = await drive((panel) => panel.handleInput(key), connectedHost(), "account");
		assert.deepEqual(r.result, { action });
	}
	const offline = await drive((panel, screen) => {
		assert.match(screen(), /Log in to pi-themes/);
		panel.handleInput("l");
	}, undefined, "account");
	assert.deepEqual(offline.result, { action: "login" });
});

test("without an account the picker never asks the cloud", async () => {
	const calls = [];
	const host = { ...connectedHost(calls), info: () => ({ connected: false, account: "Not connected", backups: "" }) };
	await drive((panel) => { panel.handleInput(KEY.esc); }, host);
	assert.deepEqual(calls, [], "the cloud is asked only once Backups is in view");
});
