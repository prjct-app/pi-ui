// Moves palette data that older versions kept inside Pi's folder into ${PRJCT_HOME}/pi-palette.
// A file is copied, its SHA-256 is compared, and only then is the original removed. A file that
// already exists at the destination with different content is never overwritten; it is reported.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

export type MigrationReport = { moved: string[]; conflicts: string[] };

const sha256 = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
const exists = (path: string) => stat(path).then(() => true, () => false);

const list = (text: string): string[] => {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

// State the current version rewrites on its own. An older copy left in Pi's folder is folded into
// the current file (or dropped) instead of being reported as a conflict on every start.
const DERIVED: Record<string, (current: string, legacy: string) => string> = {
  // Theme files this extension wrote; the union lets the next sync remove stale ones too.
  "owned-themes.json": (current, legacy) => `${JSON.stringify([...new Set([...list(current), ...list(legacy)])].sort())}\n`,
  // The weekly backup clock; the one the current version keeps is authoritative.
  "backup.json": (current) => current,
};

async function filesUnder(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return nested.flat();
}

export async function migrateLegacyPaletteData(agentDir: string, dataDir: string): Promise<MigrationReport> {
  const legacy = [
    ...(await filesUnder(join(agentDir, "pi-palette"))).map((file) => ({ file, rel: relative(join(agentDir, "pi-palette"), file) })),
    ...["palette-favorites.json", "palette-sync.json"]
      .map((name) => ({ file: join(agentDir, name), rel: name })),
  ];
  const report: MigrationReport = { moved: [], conflicts: [] };
  for (const { file, rel } of legacy) {
    if (!(await exists(file))) continue;
    const target = join(dataDir, rel);
    if (await exists(target)) {
      const merge = DERIVED[rel];
      if ((await sha256(target)) === (await sha256(file))) await unlink(file);
      else if (merge) {
        const current = await readFile(target, "utf8");
        const next = merge(current, await readFile(file, "utf8"));
        if (next !== current) await writeFile(target, next, { mode: 0o600 });
        await unlink(file);
        report.moved.push(rel);
      } else report.conflicts.push(file);
      continue;
    }
    await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
    await copyFile(file, target);
    if ((await sha256(target)) !== (await sha256(file))) throw new Error(`copy check failed for ${file}`);
    await unlink(file);
    report.moved.push(rel);
  }
  // The old folder goes only when nothing in it was left behind as a conflict.
  if (report.conflicts.length === 0) await rm(join(agentDir, "pi-palette"), { recursive: true, force: true });
  return report;
}
