import * as piCodingAgent from "@earendil-works/pi-coding-agent";
import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, type Component } from "@earendil-works/pi-tui";

/**
 * Codemode renders as one quiet line until the person expands it with the
 * tools-expand key (Ctrl+O by default). The built-in renderer shows the whole
 * script, every nested call and the output preview; expanded it still renders
 * all of that, so expanded views delegate to the built-in renderer unchanged.
 *
 * Collapsed, a run is one row like the other activity rows: the call line shows
 * only until the first result arrives, then the result line replaces it. The
 * tool renders its own shell, so the expanded view brings back the tinted box.
 *
 * The built-in codemode extension is loaded through its public factory. The
 * proxy only intercepts `registerTool` for the `codemode` name, so no internal
 * module is imported and no prototype is patched.
 */

type CodemodeCall = { status?: string; durationMs?: number; cost?: number };
type CodemodeDetails = { calls?: CodemodeCall[] };
type Theme = { fg(color: string, text: string): string; bg?(color: string, text: string): string };
type RowState = { hasResult?: boolean; callLine?: Container };
type Renderer = (...args: any[]) => any;

const WALL_TIME = /Wall time ([\d.]+) seconds/;

function wallSeconds(content: unknown): number | undefined {
	if (!Array.isArray(content)) return undefined;
	for (const part of content) {
		if (part?.type !== "text" || typeof part.text !== "string") continue;
		const match = WALL_TIME.exec(part.text);
		if (match) return Number(match[1]);
	}
	return undefined;
}

function summaryLine(
	result: { content?: unknown; details?: CodemodeDetails },
	theme: Theme,
	options: { isPartial?: boolean },
	isError: boolean,
): string {
	const calls = result.details?.calls ?? [];
	const failed = calls.some((call) => call.status === "error");
	const icon = options.isPartial
		? theme.fg("warning", "…")
		: isError || failed
			? theme.fg("error", "✗")
			: theme.fg("success", "✓");
	const seconds = wallSeconds(result.content);
	const parts = [
		`${icon} ${theme.fg("toolTitle", "codemode")}`,
		theme.fg("muted", `${calls.length} ${calls.length === 1 ? "call" : "calls"}`),
	];
	if (seconds !== undefined) parts.push(theme.fg("dim", `${seconds.toFixed(1)}s`));
	if (!options.isPartial) parts.push(`${keyHint("app.tools.expand", "to expand")}`);
	return parts.join(theme.fg("muted", " · "));
}

/**
 * Expanded output keeps the tinted box that Pi's default shell would draw. The
 * built-in renderer reuses its own last component, never the collapsed line.
 */
function expandedBox(render: Renderer | undefined, theme: Theme, context: any, call: (context: any) => Component | undefined) {
	if (!render) return undefined;
	const box = context?.lastComponent instanceof Box ? context.lastComponent : undefined;
	const component = call({ ...context, lastComponent: box?.children[0] });
	if (!component) return component;
	const color = context?.isPartial ? "toolPendingBg" : context?.isError ? "toolErrorBg" : "toolSuccessBg";
	const wrapper = box ?? new Box(1, 0);
	wrapper.setBgFn(theme.bg ? (text: string) => theme.bg!(color, text) : undefined);
	wrapper.clear();
	wrapper.addChild(component);
	return wrapper;
}

export function compactTool(tool: any) {
	const builtinCall: Renderer | undefined = tool.renderCall;
	const builtinResult: Renderer | undefined = tool.renderResult;
	return {
		...tool,
		renderShell: "self",
		renderCall(args: unknown, theme: Theme, context: any) {
			const state: RowState = context?.state ?? {};
			if (context?.expanded || !builtinCall) {
				state.callLine = undefined;
				return expandedBox(builtinCall, theme, context, (inner) => builtinCall?.(args, theme, inner));
			}
			const component = context?.lastComponent instanceof Container ? context.lastComponent : new Container();
			component.clear();
			if (context?.isPartial !== false && !state.hasResult) {
				component.addChild(new Text(`${theme.fg("warning", "…")} ${theme.fg("toolTitle", "codemode")}`, 0, 0));
			}
			state.callLine = component;
			return component;
		},
		renderResult(result: any, options: any, theme: Theme, context: any) {
			const state: RowState = context?.state ?? {};
			state.hasResult = true;
			state.callLine?.clear();
			if (options?.expanded || !builtinResult) {
				const boxed = { ...context, isPartial: options?.isPartial };
				return expandedBox(builtinResult, theme, boxed, (inner) => builtinResult?.(result, options, theme, inner));
			}
			const component = context?.lastComponent instanceof Container ? context.lastComponent : new Container();
			component.clear();
			component.addChild(new Text(summaryLine(result, theme, options, Boolean(context?.isError)), 0, 0));
			return component;
		},
	};
}

type CodemodeFactory = (pi: ExtensionAPI) => void;

/**
 * Pi before 1.1.0 has no codemode extension factory. A named import would fail
 * at link time there and take the whole activity package down, so the factory
 * is looked up at runtime and codemode stays on its built-in view without it.
 */
function resolveCodemodeFactory(): CodemodeFactory | undefined {
	const factory = (piCodingAgent as { createCodemodeExtension?: () => CodemodeFactory }).createCodemodeExtension;
	return typeof factory === "function" ? factory() : undefined;
}

/** Register the built-in codemode tool with a compact collapsed view. */
export function registerCompactCodemode(pi: ExtensionAPI, factory: CodemodeFactory | undefined = resolveCodemodeFactory()): void {
	if (!factory) return;
	const host = new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") {
				return (tool: any) => target.registerTool(tool?.name === "codemode" ? compactTool(tool) : tool);
			}
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	factory(host);
}
