import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateFileChanges } from "../src/activity/format.ts";
import {
	activeRecords,
	completedCount,
	initialState,
	recordOf,
	restoredFromBranch,
	settled,
	toolEnded,
	toolStarted,
	updateRecord,
} from "../src/activity/state.ts";

const start = (id: string, extra: Record<string, unknown> = {}) =>
	({ toolCallId: id, toolName: "read", args: { path: `${id}.ts` }, ...extra });

test("starting a tool returns a new state and leaves the previous one untouched", () => {
	const before = initialState();
	const after = toolStarted(before, start("a"), 100);
	assert.equal(before.run.size, 0);
	assert.equal(before.active.size, 0);
	assert.equal(after.run.get("a")?.status, "running");
	assert.deepEqual(activeRecords(after).map((record) => record.id), ["a"]);
	assert.equal(after.runStartedAt, 100);
});

test("ending a tool replaces its record instead of editing it", () => {
	const running = toolStarted(initialState(), start("a"), 100);
	const record = running.run.get("a")!;
	const done = toolEnded(running, { toolCallId: "a", toolName: "read", result: { content: [{ type: "text", text: "ok" }] }, isError: false }, 250);
	assert.equal(record.status, "running");
	assert.equal(record.endedAt, undefined);
	assert.equal(done.run.get("a")?.status, "success");
	assert.equal(done.run.get("a")?.durationMs, 150);
	assert.equal(done.active.size, 0);
	assert.equal(completedCount(done), 1);
});

test("nested calls are remembered so their parent shows them", () => {
	const state = toolStarted(initialState(), start("child", { parentToolCallId: "parent" }), 1);
	assert.ok(state.nested.has("child"));
	assert.ok(!initialState().nested.has("child"));
});

test("settling marks unfinished calls interrupted and keeps the final rows readable", () => {
	const running = toolStarted(toolStarted(initialState(), start("a"), 100), start("b"), 110);
	const finished = toolEnded(running, { toolCallId: "a", toolName: "read", result: { content: [] }, isError: false }, 200);
	const run = settled(finished, 300, true);
	assert.deepEqual(run.records.map((record) => record.status), ["success", "cancelled"]);
	assert.equal(run.records[1]?.outcome, "interrupted");
	assert.equal(run.startedAt, 100);
	assert.equal(run.state.run.size, 0);
	assert.equal(recordOf(run.state, "b")?.status, "cancelled", "a settled row still renders its final value");
	assert.equal(run.state.history.length, 2);
	assert.equal(finished.run.get("b")?.status, "running", "the state before settling is unchanged");
	assert.equal(settled(finished, 300, false).state.history.length, 0, "print mode keeps no summary history");
});

test("an update that changes nothing still yields a usable state", () => {
	const state = updateRecord(initialState(), "x", "bash", { command: "ls" }, (record) => record);
	assert.equal(state.run.get("x")?.target.includes("ls"), true);
});

test("density and history come back from the session branch, newest setting wins", () => {
	const entries = [
		{ type: "custom", customType: "activity-settings", data: { density: "forensic" } },
		{ type: "custom", customType: "activity-summary", data: { version: 2, records: [{ id: "r1" }, { id: "r2" }] } },
		{ type: "custom", customType: "activity-settings", data: { density: "minimal" } },
		{ type: "custom", customType: "activity-summary", data: { version: 2, records: [{ id: "r1", name: "newer" }] } },
	];
	const state = restoredFromBranch(initialState(), entries);
	assert.equal(state.density, "minimal");
	assert.deepEqual(state.history.map((record) => record.id), ["r1", "r2"]);
	assert.equal((state.history[0] as { name?: string }).name, "newer");
});

test("file changes merge per path without touching the records", () => {
	const change = { path: "a.ts", kind: "edit" as const, actions: 1, additions: 2, deletions: 1 };
	const records = [
		{ id: "1", name: "edit", target: "a.ts", category: "change" as const, status: "success" as const, startedAt: 0, durationMs: 1, change },
		{ id: "2", name: "write", target: "a.ts", category: "change" as const, status: "success" as const, startedAt: 0, durationMs: 1, change: { path: "a.ts", kind: "write" as const, actions: 1, lines: 9 } },
	];
	assert.deepEqual(aggregateFileChanges(records), [{ path: "a.ts", kind: "write", actions: 2, additions: 2, deletions: 1, lines: 9, bytes: undefined }]);
	assert.equal(change.actions, 1);
});
