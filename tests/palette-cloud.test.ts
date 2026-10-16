import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-palette-agent-"));
const { assertSecureSite, forgetAuth, readAuth, writeAuth } = await import("../src/palette/cloud.ts");

test("credentials only travel over https (http only for localhost)", () => {
	assert.equal(assertSecureSite("https://palette.prjct.app").origin, "https://palette.prjct.app");
	assert.ok(assertSecureSite("http://localhost:3000"));
	assert.ok(assertSecureSite("http://127.0.0.1:3000"));
	assert.throws(() => assertSecureSite("http://pi.prjct.app"), /use https/);
	assert.throws(() => assertSecureSite("ftp://example.com"), /use https/);
});

test("the sync token is stored privately and malformed ones are ignored", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-palette-auth-"));
	const path = join(dir, "auth.json");
	try {
		const token = `pit_${"a".repeat(64)}`;
		writeAuth({ token, username: "jj", site: "https://palette.prjct.app", connectedAt: "now" }, path);
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.equal(readAuth(path)?.token, token);
		writeFileSync(path, JSON.stringify({ token: "not-a-token" }));
		assert.equal(readAuth(path), undefined);
		forgetAuth(path);
		assert.equal(readAuth(path), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
