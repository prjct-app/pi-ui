import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { Box, Container } from "@earendil-works/pi-tui";
import { registerCompactCodemode } from "../src/activity/codemode.ts";

initTheme("dark", false);

const theme = { fg: (_color: string, text: string) => text };

const builtinCall = (args: any) => ({ built: "call", code: args.code });
const builtinResult = (_result: any, options: any) => ({ built: "result", expanded: options.expanded });

function captureCodemode() {
	const tools = new Map<string, any>();
	const fakeFactory = (host: any) => {
		host.registerTool({
			name: "codemode",
			description: "built-in",
			renderCall: builtinCall,
			renderResult: builtinResult,
			execute: async () => ({ content: [] }),
		});
	};
	const pi: any = { registerTool: (tool: any) => tools.set(tool.name, tool), getSettings: () => ({}) };
	registerCompactCodemode(pi, fakeFactory);
	return tools.get("codemode");
}

test("collapsed codemode renders one line and expanded delegates to the built-in renderer", () => {
	const tool = captureCodemode();
	assert.ok(tool, "codemode is re-registered");

	assert.equal(tool.renderShell, "self");

	const call = tool.renderCall({ code: "return 1" }, theme, { expanded: false, isPartial: true });
	assert.ok(call instanceof Container);
	assert.equal(stripVTControlCharacters(call.render(80).join("\n")).trim(), "… codemode");

	const expandedCall = tool.renderCall({ code: "return 1" }, theme, { expanded: true });
	assert.ok(expandedCall instanceof Box);
	assert.deepEqual(expandedCall.children[0], builtinCall({ code: "return 1" }));

	const result = {
		content: [{ type: "text", text: "Script completed\nWall time 2.25 seconds\nOutput:\nhello" }],
		details: { calls: [{ status: "ok" }, { status: "ok" }] },
	};
	const collapsed = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { isError: false });
	const line = stripVTControlCharacters(collapsed.render(200).join("\n"));
	assert.match(line, /codemode · 2 calls · 2\.3s/);
	assert.match(line, /to expand/);
	assert.doesNotMatch(line, /hello/);

	const expandedResult = tool.renderResult(result, { expanded: true }, theme, { isError: false });
	assert.ok(expandedResult instanceof Box);
	assert.deepEqual(expandedResult.children[0], builtinResult(result, { expanded: true }));
});

test("a finished run takes one row: the call line gives way to the result line", () => {
	const tool = captureCodemode();
	const state = {};
	const result = { content: [], details: { calls: [{ status: "ok" }] } };

	// Pi renders the call slot, then the result slot, in the same pass.
	const call = tool.renderCall({ code: "return 1" }, theme, { expanded: false, isPartial: true, state });
	assert.equal(call.render(80).length, 1);
	tool.renderResult(result, { expanded: false, isPartial: true }, theme, { isError: false, state });
	assert.equal(call.render(80).length, 0, "the first result clears the call line in the same pass");

	const settled = tool.renderCall({ code: "return 1" }, theme, { expanded: false, isPartial: false, state, lastComponent: call });
	assert.equal(settled.render(80).length, 0);

	// A resumed session renders a finished row with fresh state.
	const resumed = tool.renderCall({ code: "return 1" }, theme, { expanded: false, isPartial: false, state: {} });
	assert.equal(resumed.render(80).length, 0);
});

test("a failed nested call marks the collapsed line as failed", () => {
	const tool = captureCodemode();
	const result = { content: [], details: { calls: [{ status: "ok" }, { status: "error" }] } };
	const line = stripVTControlCharacters(
		tool.renderResult(result, { expanded: false, isPartial: false }, theme, { isError: false }).render(200).join(""),
	);
	assert.match(line, /✗ codemode · 2 calls/);
});

test("without a codemode factory the package still loads and registers nothing", () => {
	const tools = new Map<string, any>();
	registerCompactCodemode({ registerTool: (tool: any) => tools.set(tool.name, tool) } as any, undefined);
	assert.equal(tools.size, 0);
});
