import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { MouseRegion, visibleWidth } from "@earendil-works/pi-tui";
import activityMode from "../src/activity.ts";

initTheme("dark", false);

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
};

function harness(branchEntries: any[] = []) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, any[]>();
	const renderers = new Map<string, any>();
	const entries: Array<{ type: "custom"; customType: string; data: any }> = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const customComponents: any[] = [];
	const workingMessages: Array<string | undefined> = [];
	const statuses: Array<{ key: string; text: string | undefined }> = [];
	const widgets: Array<{ key: string; content: any; options?: unknown }> = [];
	const uiState: Record<string, unknown> = {};
	const tui = { requestRender() { uiState.renderRequests = Number(uiState.renderRequests ?? 0) + 1; } };
	const bindingKeys: Record<string, string[]> = {
		"tui.select.up": ["up"],
		"tui.select.down": ["down"],
		"tui.select.confirm": ["enter"],
		"tui.select.cancel": ["escape", "ctrl+c"],
	};
	const keybindings = {
		matches(data: string, id: string) {
			if (id === "tui.select.confirm") return data === "\r";
			if (id === "tui.select.cancel") return data === "\x1b" || data === "\x03";
			if (id === "tui.select.up") return data === "\x1b[A";
			if (id === "tui.select.down") return data === "\x1b[B";
			return false;
		},
		getKeys: (id: string) => bindingKeys[id] ?? [],
	};

	const pi = {
		registerTool: (tool: any) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: any) => commands.set(name, command),
		registerEntryRenderer: (name: string, renderer: any) => renderers.set(name, renderer),
		on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		appendEntry: (customType: string, data: any) => {
			const entry = { type: "custom" as const, customType, data };
			entries.push(entry);
			branchEntries.push(entry);
		},
	};
	activityMode(pi as any);

	const ctx: any = {
		mode: "tui",
		hasUI: true,
		cwd: process.cwd(),
		sessionManager: { getBranch: () => branchEntries },
		ui: {
			theme,
			setToolsExpanded: (value: boolean) => { uiState.toolsExpanded = value; },
			setWorkingIndicator: (value?: unknown) => { uiState.workingIndicator = value; },
			setWorkingMessage: (value?: string) => workingMessages.push(value),
			setStatus: (key: string, text?: string) => statuses.push({ key, text }),
			setWidget: (key: string, content: any, options?: unknown) => widgets.push({ key, content, options }),
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			custom: async (factory: any) => {
				const component = await factory(tui, theme, keybindings, () => {});
				customComponents.push(component);
				return undefined;
			},
		},
	};

	return {
		tools,
		commands,
		renderers,
		entries,
		notifications,
		customComponents,
		workingMessages,
		statuses,
		widgets,
		uiState,
		ctx,
		emit(name: string, event: Record<string, unknown> = {}) {
			for (const handler of handlers.get(name) ?? []) handler(event, ctx);
		},
	};
}

function renderContext(overrides: Record<string, unknown> = {}) {
	return {
		args: {},
		toolCallId: "tool-1",
		invalidate() {},
		lastComponent: undefined,
		state: {},
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: true,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}

function rendered(component: { render(width: number): string[] }, width = 100): string[] {
	const lines = component.render(width);
	assert.ok(lines.every((line) => visibleWidth(line) <= width), `line exceeded ${width} columns`);
	return lines.map((line) => stripVTControlCharacters(line).trimEnd()).filter((line) => line.trim());
}

function result(text: string, details?: unknown) {
	return { content: [{ type: "text", text }], details };
}

test("compact rows are semantic, responsive, and expose rich details only when expanded", () => {
	const h = harness();
	h.emit("session_start", { reason: "startup" });
	const tool = h.tools.get("read");
	const args = { path: "src/example.ts", offset: 10 };
	const pendingContext = renderContext({ toolCallId: "read-1", args });
	const hiddenPending = tool.renderCall(args, theme, pendingContext);
	assert.deepEqual(rendered(hiddenPending), []);
	assert.deepEqual(new MouseRegion(hiddenPending, () => undefined).render(100), [],
		"Pi may wrap a hidden renderer in MouseRegion without crashing");

	h.emit("tool_execution_start", { toolCallId: "read-1", toolName: "read", args });
	h.emit("tool_result", {
		toolCallId: "read-1",
		toolName: "read",
		input: args,
		content: [{ type: "text", text: "const value = 1;\nexport { value };" }],
		details: undefined,
		isError: false,
	});
	h.emit("tool_execution_end", { toolCallId: "read-1", toolName: "read", result: result("const value = 1;\nexport { value };"), isError: false });

	const completeContext = renderContext({ toolCallId: "read-1", args, isPartial: false });
	assert.deepEqual(rendered(tool.renderCall(args, theme, completeContext)), []);
	assert.deepEqual(rendered(tool.renderResult(result("const value = 1;\nexport { value };"), { expanded: false, isPartial: false }, theme, completeContext)), []);
	const expanded = tool.renderResult(result("const value = 1;\nexport { value };"), { expanded: true, isPartial: false }, theme, completeContext);
	const expandedLines = rendered(expanded).map((line) => line.trimStart());
	assert.deepEqual(expandedLines.slice(0, 2), ["10 │ const value = 1;", "11 │ export { value };"]);
	assert.match(expandedLines[2] ?? "", /^Took \d+ms$/);
});

test("expanded edit, write, and truncated search results preserve diagnostic detail", () => {
	const h = harness();
	h.emit("session_start", { reason: "startup" });

	const editArgs = { path: "src/a.ts", edits: [{ oldText: "old", newText: "new" }] };
	const editResult = result("Done", { diff: "@@ -1 +1 @@\n-old\n+new" });
	const editContext = renderContext({ toolCallId: "expanded-edit", args: editArgs, isPartial: false, expanded: true });
	const editLines = rendered(h.tools.get("edit").renderResult(editResult, { expanded: true, isPartial: false }, theme, editContext));
	assert.ok(editLines.some((line) => line.includes("-old")));
	assert.ok(editLines.some((line) => line.includes("+new")));

	const writeArgs = { path: "src/new.ts", content: "const one = 1;\nconst two = 2;" };
	const writeContext = renderContext({ toolCallId: "expanded-write", args: writeArgs, isPartial: false, expanded: true });
	const writeLines = rendered(h.tools.get("write").renderResult(result("written"), { expanded: true, isPartial: false }, theme, writeContext));
	assert.deepEqual(writeLines.map((line) => line.trimStart()).slice(0, 2), ["1 │ const one = 1;", "2 │ const two = 2;"]);

	const grepArgs = { pattern: "TODO", path: "src" };
	const grepContext = renderContext({ toolCallId: "expanded-grep", args: grepArgs, isPartial: false, expanded: true });
	const grepLines = rendered(h.tools.get("grep").renderResult(
		result("src/a.ts:1:TODO", { truncation: { truncated: true, outputLines: 1, totalLines: 20 }, fullOutputPath: "/tmp/full.log" }),
		{ expanded: true, isPartial: false },
		theme,
		grepContext,
	));
	assert.ok(grepLines.some((line) => line.includes("Truncated: showing 1 of 20 lines")));
	assert.ok(grepLines.some((line) => line.includes("Full output: /tmp/full.log")));
});

test("tool-specific outcomes include search counts, write size, edit deltas, errors, and cancellation", () => {
	const h = harness();
	h.emit("session_start", { reason: "startup" });

	const scenarios = [
		{ id: "grep", name: "grep", args: { pattern: "TODO", path: "src" }, value: result("src/a.ts:2:TODO\nsrc/b.ts:4:TODO"), expected: "2 matches" },
		{ id: "grep-empty", name: "grep", args: { pattern: "missing", path: "src" }, value: result("No matches found"), expected: "no matches" },
		{ id: "write", name: "write", args: { path: "a.txt", content: "one\ntwo" }, value: result("Successfully wrote a.txt"), expected: "2 lines · 7 B" },
		{ id: "edit", name: "edit", args: { path: "a.ts", edits: [{ oldText: "a", newText: "b" }] }, value: result("Done", { diff: "@@\n-a\n+b" }), expected: "1 block · +1 −1" },
	];
	for (const scenario of scenarios) {
		h.emit("tool_execution_start", { toolCallId: scenario.id, toolName: scenario.name, args: scenario.args });
		h.emit("tool_result", { toolCallId: scenario.id, toolName: scenario.name, input: scenario.args, content: scenario.value.content, details: scenario.value.details, isError: false });
		h.emit("tool_execution_end", { toolCallId: scenario.id, toolName: scenario.name, result: scenario.value, isError: false });
		const row = h.tools.get(scenario.name).renderCall(scenario.args, theme, renderContext({ toolCallId: scenario.id, args: scenario.args, isPartial: false }));
		if (scenario.name === "grep") {
			assert.deepEqual(rendered(row), []);
			continue;
		}
		assert.match(rendered(row)[0] ?? "", new RegExp(scenario.expected.replace(/[+]/g, "\\+")));
	}

	const failedArgs = { command: "npm run lint" };
	const failed = result("lint output\n\nCommand exited with code 2");
	h.emit("tool_execution_start", { toolCallId: "failed", toolName: "bash", args: failedArgs });
	h.emit("tool_result", { toolCallId: "failed", toolName: "bash", input: failedArgs, content: failed.content, details: undefined, isError: true });
	h.emit("tool_execution_end", { toolCallId: "failed", toolName: "bash", result: failed, isError: true });
	assert.match(rendered(h.tools.get("bash").renderCall(failedArgs, theme, renderContext({ toolCallId: "failed", args: failedArgs, isPartial: false, isError: true })))[0] ?? "", /✕ RUN.*exit 2/);

	const cancelled = result("Command aborted");
	h.emit("tool_execution_start", { toolCallId: "cancelled", toolName: "bash", args: { command: "sleep 5" } });
	h.emit("tool_execution_end", { toolCallId: "cancelled", toolName: "bash", result: cancelled, isError: true });
	assert.match(rendered(h.tools.get("bash").renderCall({ command: "sleep 5" }, theme, renderContext({ toolCallId: "cancelled", args: { command: "sleep 5" }, isPartial: false, isError: true })))[0] ?? "", /◇ RUN.*cancelled/);
});

test("live widget, status, working message, and waiting state track parallel activity", () => {
	const h = harness();
	h.emit("session_start", { reason: "startup" });
	assert.equal(h.uiState.toolsExpanded, false);
	assert.equal(h.uiState.workingIndicator, undefined, "Pi's default working indicator must not be overridden");

	h.emit("agent_start");
	h.emit("tool_execution_start", { toolCallId: "a", toolName: "read", args: { path: "src/a.ts" } });
	h.emit("tool_execution_start", { toolCallId: "b", toolName: "bash", args: { command: "npm test" } });
	assert.equal(h.workingMessages.at(-1), undefined);
	const widgetFactory = h.widgets.at(-1)?.content;
	const widget = widgetFactory({}, theme);
	const widgetLines = rendered(widget).slice(0, 3).map((line) => line.trimEnd());
	assert.equal(widgetLines[0], "◆ READ · RUN");
	assert.equal(widgetLines.length, 1);

	h.emit("ui_prompt_start", { reason: "ui_prompt", kind: "confirm" });
	assert.equal(h.workingMessages.at(-1), undefined);
	assert.equal(h.statuses.at(-1)?.text, undefined);
	h.emit("ui_prompt_end", { reason: "ui_prompt", kind: "confirm" });
	h.emit("tool_execution_end", { toolCallId: "b", toolName: "bash", result: result("ok"), isError: false });
	assert.equal(h.workingMessages.at(-1), undefined);
	h.emit("tool_execution_end", { toolCallId: "a", toolName: "read", result: result("content"), isError: false });
	h.emit("agent_settled");
	assert.equal(h.workingMessages.at(-1), undefined);
	assert.equal(h.widgets.at(-1)?.content, undefined);

	h.emit("ui_prompt_start", { reason: "ui_prompt", kind: "custom" });
	assert.equal(h.widgets.at(-1)?.content, undefined, "a panel the person opened while idle is not waiting for input");
	h.emit("ui_prompt_end", { reason: "ui_prompt", kind: "custom" });
	assert.equal(h.statuses.at(-1)?.text, undefined);
});

test("activity summary groups observed changes, verification, issues, and truncation", () => {
	const h = harness();
	h.emit("session_start", { reason: "startup" });
	h.emit("agent_start");

	const editArgs = { path: "src/a.ts", edits: [{ oldText: "old", newText: "new\nline" }] };
	const editResult = result("Done", { diff: "@@\n-old\n+new\n+line" });
	h.emit("tool_execution_start", { toolCallId: "edit", toolName: "edit", args: editArgs });
	h.emit("tool_result", { toolCallId: "edit", toolName: "edit", input: editArgs, content: editResult.content, details: editResult.details, isError: false });
	h.emit("tool_execution_end", { toolCallId: "edit", toolName: "edit", result: editResult, isError: false });

	const testArgs = { command: "npm test" };
	h.emit("tool_execution_start", { toolCallId: "test", toolName: "bash", args: testArgs });
	h.emit("tool_execution_end", { toolCallId: "test", toolName: "bash", result: result("24 passed"), isError: false });

	const lintArgs = { command: "npm run lint" };
	const lintResult = result("src/a.ts:42 unused token\nCommand exited with code 1");
	h.emit("tool_execution_start", { toolCallId: "lint", toolName: "bash", args: lintArgs });
	h.emit("tool_execution_end", { toolCallId: "lint", toolName: "bash", result: lintResult, isError: true });

	const readArgs = { path: "large.log" };
	const readResult = result("one\ntwo", { truncation: { truncated: true, outputLines: 2, totalLines: 100 } });
	h.emit("tool_execution_start", { toolCallId: "read", toolName: "read", args: readArgs });
	h.emit("tool_execution_end", { toolCallId: "read", toolName: "read", result: readResult, isError: false });
	h.emit("agent_settled");

	const summaryEntry = h.entries.find((entry) => entry.customType === "activity-summary");
	assert.ok(summaryEntry);
	assert.equal(summaryEntry.data.version, 2);
	assert.equal(summaryEntry.data.actionCount, 4);
	assert.equal(summaryEntry.data.errorCount, 1);
	assert.equal(summaryEntry.data.cancelledCount, 0);
	assert.equal(summaryEntry.data.truncatedCount, 1);
	assert.deepEqual(summaryEntry.data.modifiedFiles, [{ path: "src/a.ts", kind: "edit", actions: 1, additions: 2, deletions: 1 }]);
	assert.equal(summaryEntry.data.categoryCounts.verify, 2);
	assert.equal(summaryEntry.data.records.find((record: any) => record.id === "test")?.outcome, "24 passed");

	const renderer = h.renderers.get("activity-summary");
	assert.deepEqual(rendered(renderer({ data: summaryEntry.data }, { expanded: false }, theme)), []);
	assert.deepEqual(rendered(renderer({ data: summaryEntry.data }, { expanded: true }, theme)), []);
});

test("activity inspector and density settings are interactive and session-persistent", async () => {
	const h = harness();
	h.emit("session_start", { reason: "startup" });
	const args = { path: "src/a.ts", content: "one\ntwo" };
	h.emit("tool_execution_start", { toolCallId: "write", toolName: "write", args });
	h.emit("tool_execution_end", { toolCallId: "write", toolName: "write", result: result("written"), isError: false });
	h.emit("agent_settled");

	await h.commands.get("activity").handler("", h.ctx);
	const inspector = h.customComponents.at(-1);
	assert.ok(rendered(inspector).some((line) => line.includes("Activity inspector")));
	inspector.handleInput("3");
	assert.ok(rendered(inspector).some((line) => line.includes("No activity in this filter")));
	inspector.handleInput("2");
	inspector.handleInput("\r");
	const inspected = rendered(inspector);
	assert.ok(inspected.some((line) => line.includes("Change") && line.includes("src/a.ts")));
	assert.ok(inspected.some((line) => line.includes("written")));

	await h.commands.get("activity-settings").handler("", h.ctx);
	const settings = h.customComponents.at(-1);
	settings.handleInput("\r");
	const saved = h.entries.find((entry) => entry.customType === "activity-settings");
	assert.equal(saved?.data.density, "forensic");

	const resumed = harness([...h.entries]);
	resumed.emit("session_start", { reason: "resume" });
	const readArgs = { path: "a.ts" };
	resumed.emit("tool_execution_start", { toolCallId: "r", toolName: "read", args: readArgs });
	resumed.emit("tool_execution_end", { toolCallId: "r", toolName: "read", result: result("one"), isError: false });
	const row = resumed.tools.get("read").renderCall(readArgs, theme, renderContext({ toolCallId: "r", args: readArgs, isPartial: false, expanded: true }));
	assert.match(rendered(row)[0] ?? "", /1 line · \d+ms · inspect/);
});

test("built-in execution remains bound to the active session context", async () => {
	const h = harness();
	const cwd = mkdtempSync(join(tmpdir(), "pi-activity-"));
	const signal = new AbortController().signal;
	const executionContext = {
		...h.ctx,
		cwd,
		model: { provider: "test-provider", id: "test-model", input: ["text"] },
		thinkingLevel: "high",
		sessionManager: {
			...h.ctx.sessionManager,
			getSessionId: () => "session-test",
			getSessionFile: () => "/tmp/session-test.jsonl",
		},
	};
	try {
		await h.tools.get("write").execute("write", { path: "fixture.txt", content: "fixture" }, signal, undefined, executionContext);
		assert.equal(readFileSync(join(cwd, "fixture.txt"), "utf8"), "fixture");
		const readResult = await h.tools.get("read").execute("read", { path: "fixture.txt" }, signal, undefined, executionContext);
		assert.equal(readResult.content[0].text, "fixture");

		const bashResult = await h.tools.get("bash").execute(
			"bash",
			{ command: "printf '%s|%s|%s|%s' \"$PI_SESSION_ID\" \"$PI_PROVIDER\" \"$PI_MODEL\" \"$PI_REASONING_LEVEL\"" },
			signal,
			undefined,
			executionContext,
		);
		assert.equal(bashResult.content[0].text, "session-test|test-provider|test-model|high");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("non-TUI session lifecycle never calls terminal-only UI methods", () => {
	const h = harness();
	h.ctx.mode = "rpc";
	h.ctx.ui = new Proxy({} as any, { get: () => { throw new Error("Unexpected terminal UI call"); } });
	h.emit("session_start", { reason: "startup" });
	h.emit("agent_start");
	h.emit("tool_execution_start", { toolCallId: "a", toolName: "read", args: { path: "a.ts" } });
	h.emit("tool_execution_end", { toolCallId: "a", toolName: "read", result: result("a"), isError: false });
	h.emit("agent_settled");
	h.emit("session_shutdown", { reason: "quit" });
});

test("streaming previews read only the visible head and persisted targets stay one line", async () => {
	const { resultPreview, previewText, snapshotRecord, PREVIEW_LINES } = await import("../src/format.ts");
	const long = Array.from({ length: 5_000 }, (_, index) => `line ${index}`).join("\n");
	const preview = resultPreview({ content: [{ type: "text", text: `\n\n${long}` }, { type: "text", text: "tail" }] });
	assert.equal(preview.split("\n").length, PREVIEW_LINES);
	assert.match(preview, /^line 0\nline 1/);
	assert.equal(previewText("x".repeat(5_000)).length, 1_998, "same cap as the old 2,000-character preview");
	assert.equal(resultPreview({ content: [{ type: "image", data: "abc" }] }), "");
	const snapshot = snapshotRecord({
		id: "b1", name: "bash", target: `cat <<'EOF'\n${"y".repeat(28_000)}`, category: "run", status: "success",
		startedAt: 1, durationMs: 2, args: {},
	} as never);
	assert.equal(snapshot.target.length, 240);
	assert.match(snapshot.target, /…$/);
});

test("rows rebuilt from history keep a still duration and reuse their render", () => {
	const h = harness();
	h.emit("session_start", { reason: "resume" });
	const tool = h.tools.get("bash");
	const args = { command: `cat > big.txt <<'EOF'\n${"línea 🚀\n".repeat(4_000)}EOF` };
	const context = renderContext({ toolCallId: "bash-history", args, isPartial: false });
	tool.renderCall(args, theme, context);
	const row = tool.renderResult(result("done"), { expanded: false, isPartial: false }, theme, context);
	const realNow = Date.now;
	try {
		const first = row.render(120);
		Date.now = () => realNow() + 60_000;
		const second = row.render(120);
		assert.equal(second, first, "an unchanged historical row returns its cached lines");
		assert.doesNotMatch(stripVTControlCharacters(first[0]!), /\d+(ms|s|m)\b/, "no invented duration without a measured one");
		assert.ok(visibleWidth(first[0]!) <= 120);
	} finally {
		Date.now = realNow;
	}
});
