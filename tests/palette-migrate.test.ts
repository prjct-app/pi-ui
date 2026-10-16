import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateLegacyPaletteData } from "../src/palette/migrate.ts";

async function setup() {
  const agent = await mkdtemp(join(tmpdir(), "palette-agent-"));
  const data = await mkdtemp(join(tmpdir(), "palette-data-"));
  await mkdir(join(agent, "pi-palette", "backups"), { recursive: true });
  await writeFile(join(agent, "pi-palette", "auth.json"), '{"token":"pit_x"}');
  await writeFile(join(agent, "pi-palette", "library.json"), '{"palettes":[]}');
  await writeFile(join(agent, "pi-palette", "backups", "v1.json"), "{}");
  await writeFile(join(agent, "palette-favorites.json"), '["a"]');
  await writeFile(join(agent, "palette-sync.json"), '{"theme":"x"}');
  return { agent, data };
}

test("legacy palette files move to the data folder, verified, and the old copies are removed", async () => {
  const { agent, data } = await setup();
  const report = await migrateLegacyPaletteData(agent, data);
  assert.equal(report.conflicts.length, 0);
  assert.equal(await readFile(join(data, "auth.json"), "utf8"), '{"token":"pit_x"}');
  assert.equal(await readFile(join(data, "backups", "v1.json"), "utf8"), "{}");
  assert.equal(await readFile(join(data, "palette-favorites.json"), "utf8"), '["a"]');
  await assert.rejects(readFile(join(agent, "pi-palette", "auth.json")));
  await assert.rejects(readFile(join(agent, "palette-sync.json")));
});

test("a destination that differs is never overwritten and its source is kept", async () => {
  const { agent, data } = await setup();
  await mkdir(data, { recursive: true });
  await writeFile(join(data, "library.json"), '{"palettes":["new"]}');
  const report = await migrateLegacyPaletteData(agent, data);
  assert.equal(report.conflicts.length, 1);
  assert.equal(await readFile(join(data, "library.json"), "utf8"), '{"palettes":["new"]}');
  assert.equal(await readFile(join(agent, "pi-palette", "library.json"), "utf8"), '{"palettes":[]}');
});

test("stale copies of state the extension rewrites are merged, not reported as conflicts", async () => {
  const { agent, data } = await setup();
  await writeFile(join(agent, "pi-palette", "owned-themes.json"), '["old.json","shared.json"]');
  await writeFile(join(agent, "pi-palette", "backup.json"), '{"checkedAt":2}');
  await writeFile(join(data, "owned-themes.json"), '["shared.json","synapse.json"]\n');
  await writeFile(join(data, "backup.json"), '{"checkedAt":1}');
  const report = await migrateLegacyPaletteData(agent, data);
  assert.equal(report.conflicts.length, 0);
  assert.deepEqual(JSON.parse(await readFile(join(data, "owned-themes.json"), "utf8")), ["old.json", "shared.json", "synapse.json"]);
  assert.equal(await readFile(join(data, "backup.json"), "utf8"), '{"checkedAt":1}');
  await assert.rejects(readFile(join(agent, "pi-palette", "owned-themes.json")));
  const again = await migrateLegacyPaletteData(agent, data);
  assert.deepEqual(again, { moved: [], conflicts: [] });
});
