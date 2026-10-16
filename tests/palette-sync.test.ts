import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDirectory = mkdtempSync(join(tmpdir(), "pi-palette-sync-"));
process.env.PI_CODING_AGENT_DIR = agentDirectory;

const { watchActiveTheme, writeActiveTheme } = await import("../src/palette/sync.ts");

function waitForTheme(themes: string[], expected: string, timeoutMs = 1_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const startedAt = Date.now();
		const timer = setInterval(() => {
			if (themes.includes(expected)) {
				clearInterval(timer);
				resolve();
				return;
			}
			if (Date.now() - startedAt >= timeoutMs) {
				clearInterval(timer);
				reject(new Error(`Timed out waiting for ${expected}`));
			}
		}, 10);
	});
}

test("palette changes reach another active watcher and stop after disposal", async () => {
	const received: string[] = [];
	const stop = watchActiveTheme((theme) => received.push(theme), 20);

	try {
		// watchFile takes its first snapshot asynchronously; a write before it lands
		// becomes the baseline and is never reported. Let the poller settle first.
		await new Promise((resolve) => setTimeout(resolve, 100));
		writeActiveTheme("exception");
		await waitForTheme(received, "exception");
		assert.deepEqual(received, ["exception"]);

		stop();
		writeActiveTheme("debug");
		await new Promise((resolve) => setTimeout(resolve, 80));
		assert.deepEqual(received, ["exception"]);
	} finally {
		stop();
		rmSync(agentDirectory, { recursive: true, force: true });
	}
});
