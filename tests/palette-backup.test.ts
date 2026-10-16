import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-palette-agent-"));
const { WEEK_MS, isDue, listVersions, readState, readVersion, runBackup, saveBeforeRestore } = await import("../src/palette/backup.ts");
const { factText, nextCheck } = await import("../src/palette/backup-ui.ts");
const { readBundled } = await import("../src/palette/library.ts");

type Library = import("../src/palette/library.ts").Library;

const base = readBundled().palettes[0]!;
const palette = (id: string) => ({ ...base, id, label: id });
const library = (...ids: string[]): Library => ({ format: "pi-palette", version: 1, favorites: ["dracula"], palettes: ids.map(palette) });

function sandbox() {
	const root = mkdtempSync(join(tmpdir(), "pi-palette-backup-"));
	return {
		root,
		paths: { dir: join(root, "backups"), statePath: join(root, "backup.json"), lockPath: join(root, "backup.lock") },
		done: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("local only: a version per change, none for an unchanged library, the oldest dropped past the limit", async () => {
	const box = sandbox();
	try {
		const at = (day: number) => new Date(Date.UTC(2026, 9, day));
		const first = await runBackup({ local: library("a"), reason: "weekly", now: at(1), keep: 3, ...box.paths });
		assert.equal(first?.written, true);
		assert.equal(first?.localCount, 1);
		assert.equal(first?.cloudCount, undefined);
		assert.equal(readState(box.paths.statePath).checkedAt, at(1).getTime());

		// The same library with a new export time is the same library.
		const same = await runBackup({ local: { ...library("a"), exportedAt: "later" }, reason: "weekly", now: at(8), ...box.paths });
		assert.equal(same?.written, false);
		assert.equal(readState(box.paths.statePath).checkedAt, at(8).getTime(), "an unchanged run still resets the weekly clock");

		for (const [day, ids] of [[15, ["a", "b"]], [22, ["a", "b", "c"]], [29, ["c"]]] as const) {
			await runBackup({ local: library(...ids), reason: "manual", now: at(day), keep: 3, ...box.paths });
		}
		const versions = listVersions(box.paths.dir);
		assert.equal(versions.length, 3);
		assert.deepEqual(versions.map((v) => v.palettes), [["c"], ["a", "b", "c"], ["a", "b"]]);
		assert.equal(versions[0]!.reason, "manual");
		assert.equal(readdirSync(box.paths.dir).length, 3);
	} finally {
		box.done();
	}
});

test("connected: the cloud is copied here before this library is sent up", async () => {
	const box = sandbox();
	try {
		const calls: string[] = [];
		const result = await runBackup({
			local: library("mine"),
			reason: "weekly",
			cloud: {
				pull: async () => { calls.push("pull"); return { ...library("from-cloud"), user: "jj" }; },
				push: async (lib) => { calls.push(`push:${lib.palettes.map((p) => p.id).join(",")}`); return { count: 4 }; },
			},
			...box.paths,
		});
		assert.deepEqual(calls, ["pull", "push:mine"]);
		assert.equal(result?.cloudCount, 4);
		const version = readVersion(listVersions(box.paths.dir)[0]!.file, box.paths.dir);
		assert.deepEqual(version.local.palettes.map((p) => p.id), ["mine"]);
		assert.deepEqual(version.cloud?.palettes.map((p) => p.id), ["from-cloud"]);
		assert.equal(version.user, "jj");
		const state = readState(box.paths.statePath);
		assert.equal(state.cloudCount, 4);
		assert.equal(state.cloudError, undefined);
	} finally {
		box.done();
	}
});

test("a cloud failure never costs the local backup, and a rejected token is flagged", async () => {
	const box = sandbox();
	try {
		const rejected = new Error("unauthorized");
		const result = await runBackup({
			local: library("mine"),
			reason: "weekly",
			cloud: {
				pull: async () => library("from-cloud"),
				push: async () => { throw rejected; },
			},
			isUnauthorized: (error) => error === rejected,
			...box.paths,
		});
		assert.equal(result?.written, true);
		assert.equal(result?.cloudError, "unauthorized");
		assert.equal(result?.unauthorized, true);
		// What the cloud held was still copied here.
		assert.ok(readVersion(listVersions(box.paths.dir)[0]!.file, box.paths.dir).cloud);
		assert.equal(readState(box.paths.statePath).cloudError, "unauthorized");

		// Offline next time: an unchanged library with no cloud copy is not a new version.
		const offline = await runBackup({
			local: library("mine"),
			reason: "weekly",
			cloud: { pull: async () => { throw new Error("offline"); }, push: async () => ({ count: 1 }) },
			...box.paths,
		});
		assert.equal(offline?.written, false);
		assert.equal(offline?.cloudError, "offline");
	} finally {
		box.done();
	}
});

test("one backup at a time across Pi windows", async () => {
	const box = sandbox();
	try {
		const release = { run: (): void => undefined };
		const gate = new Promise<void>((resolve) => { release.run = resolve; });
		const slow = runBackup({
			local: library("a"),
			reason: "weekly",
			cloud: { pull: async () => { await gate; return library(); }, push: async () => ({ count: 1 }) },
			...box.paths,
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(await runBackup({ local: library("a"), reason: "weekly", ...box.paths }), undefined);
		release.run();
		assert.equal((await slow)?.written, true);
		// A lock left by a Pi that died long ago does not block forever.
		writeFileSync(box.paths.lockPath, "123");
		const { utimesSync } = await import("node:fs");
		const old = new Date(Date.now() - 60 * 60 * 1000);
		utimesSync(box.paths.lockPath, old, old);
		assert.notEqual(await runBackup({ local: library("b"), reason: "manual", ...box.paths }), undefined);
	} finally {
		box.done();
	}
});

test("a restore saves the current library first, without moving the weekly clock", async () => {
	const box = sandbox();
	try {
		await runBackup({ local: library("a"), reason: "weekly", now: new Date(Date.UTC(2026, 9, 1)), ...box.paths });
		const state = readState(box.paths.statePath);
		const file = await saveBeforeRestore(library("a", "b"), box.paths);
		assert.ok(file);
		assert.equal(listVersions(box.paths.dir)[0]!.reason, "restore");
		assert.deepEqual(readState(box.paths.statePath), state);
	} finally {
		box.done();
	}
});

test("versions stay in order when the clock goes back, and only backup files are read", async () => {
	const box = sandbox();
	try {
		await runBackup({ local: library("a"), reason: "weekly", now: new Date(Date.UTC(2026, 9, 10)), ...box.paths });
		await runBackup({ local: library("b"), reason: "weekly", now: new Date(Date.UTC(2026, 9, 1)), ...box.paths });
		assert.deepEqual(listVersions(box.paths.dir).map((v) => v.palettes), [["b"], ["a"]]);
		writeFileSync(join(box.paths.dir, "2026-10-20T00-00-00-000Z.json"), "not json");
		assert.equal(listVersions(box.paths.dir).length, 2);
		assert.throws(() => readVersion("../backup.json", box.paths.dir), /not a backup file/);
	} finally {
		box.done();
	}
});

test("the weekly clock and the picker's backup summary", () => {
	const now = Date.UTC(2026, 9, 10);
	assert.equal(isDue({}, now), true);
	assert.equal(isDue({ checkedAt: now - 6 * 24 * 3_600_000 }, now), false);
	assert.equal(isDue({ checkedAt: now - WEEK_MS }, now), true);
	assert.equal(isDue({ checkedAt: now + 60_000 }, now), true, "a check from the future (clock change) is not trusted");
	assert.equal(nextCheck({ checkedAt: now - 2 * 24 * 3_600_000 }, now), "in 5d");
	assert.equal(nextCheck({ checkedAt: now - WEEK_MS + 3_600_000 }, now), "in 1h");
	assert.equal(factText({}, 0, false, false, now), "palette backup pending");
	assert.equal(factText({}, 0, false, true, now), "palette backup…");
	assert.equal(factText({ checkedAt: now - 2 * 24 * 3_600_000 }, 7, false, false, now), "palette backup 2d ago · 7 local");
	assert.equal(factText({ checkedAt: now, cloudCount: 7 }, 7, true, false, now), "palette backup now · 7 local · 7 cloud");
	assert.equal(factText({ checkedAt: now, cloudError: "x" }, 7, true, false, now), "palette backup now · 7 local · cloud ✕");
});
