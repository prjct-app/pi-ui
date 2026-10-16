import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	getSettingsListTheme,
	keyHint,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Container, SettingsList, Text, type SettingItem } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";
import {
	ActiveToolsWidget,
	ActivityInspectorComponent,
	ActivityRowComponent,
	ActivitySummaryComponent,
	renderExpandedToolResult,
} from "./components.ts";
import { aggregateFileChanges, formatDuration, snapshotRecord, TOOL_VERBS, withToolResult } from "./format.ts";
import { registerCompactCodemode } from "./codemode.ts";
import {
	activeRecords,
	completedCount,
	DENSITIES,
	HISTORY_LIMIT,
	initialState,
	isDensity,
	recordOf,
	restoredFromBranch,
	settled,
	toolEnded,
	toolStarted,
	updateRecord,
	withoutRun,
	withPreview,
	type ActivityState,
} from "./state.ts";
import type { ActivityCategory, ActivityRecord, ActivitySummaryData } from "./types.ts";

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

export default function activityMode(pi: ExtensionAPI) {
	// The one cell that changes: it holds the current state value, which is always replaced, never edited.
	const session: { state: ActivityState } = { state: initialState() };
	const set = (next: ActivityState): void => {
		session.state = next;
	};

	function setWorkingMessage(ctx: ExtensionContext, message: string | undefined): void {
		if (message === session.state.lastWorkingMessage) return;
		set({ ...session.state, lastWorkingMessage: message });
		ctx.ui.setWorkingMessage(message);
	}

	function refreshPresence(ctx: ExtensionContext, settled = false): void {
		if (ctx.mode !== "tui") return;
		const records = activeRecords(session.state);
		if (settled) {
			ctx.ui.setWidget("pi-activity", undefined);
			setWorkingMessage(ctx, undefined);
			return;
		}

		if (session.state.waitingForUser || records.length) {
			ctx.ui.setWidget(
				"pi-activity",
				(_tui, theme) => new ActiveToolsWidget(
					() => activeRecords(session.state),
					() => completedCount(session.state),
					() => session.state.waitingForUser,
					theme,
				),
				{ placement: "aboveEditor" },
			);
		} else {
			ctx.ui.setWidget("pi-activity", undefined);
		}

		if (session.state.waitingForUser) {
			setWorkingMessage(ctx, "Waiting for input…");
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("warning", "! waiting for input"));
			return;
		}
		if (records.length) {
			const first = records[0]!;
			const verb = TOOL_VERBS[first.name] ?? first.name.toUpperCase();
			const message = records.length > 1
				? `${records.length} active · ${verb} ${first.target}`
				: `${verb} ${first.target}`;
			setWorkingMessage(ctx, message);
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("accent", `◆ ${records.length} active · ${completedCount(session.state)} done`));
			return;
		}
		if (session.state.agentRunning) {
			setWorkingMessage(ctx, "Thinking…");
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", "◆ thinking"));
		} else {
			setWorkingMessage(ctx, undefined);
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `◇ ready · ${session.state.density}`));
		}
	}

	pi.registerEntryRenderer("activity-summary", (entry, options, theme) => {
		// Quiet by default: the transcript shows the summary only when expanded (Ctrl+O). The footer status stays.
		if (!options.expanded) return new Container();
		return new ActivitySummaryComponent(
			(entry.data ?? {}) as ActivitySummaryData,
			options.expanded,
			theme,
		);
	});

	// Settings are persisted as invisible session entries and restored on resume/tree navigation.
	pi.registerEntryRenderer("activity-settings", () => new Container());

	function registerCompactTool<T extends TSchema, D>(createTool: (cwd: string) => AgentTool<T, D>) {
		const initialTool = createTool(process.cwd());
		const name = initialTool.name;
		pi.registerTool({
			...initialTool,
			name,
			renderShell: "self",
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				// Pi supplies ExtensionContext as a fifth argument at runtime, although
				// AgentTool's public execute type currently exposes only the first four.
				const executeWithContext = createTool(ctx.cwd).execute as (
					id: string,
					input: Parameters<AgentTool<T, D>["execute"]>[1],
					abortSignal: Parameters<AgentTool<T, D>["execute"]>[2],
					update: Parameters<AgentTool<T, D>["execute"]>[3],
					context: ExtensionContext,
				) => ReturnType<AgentTool<T, D>["execute"]>;
				return executeWithContext(toolCallId, params, signal, onUpdate, ctx);
			},
			renderCall(args, theme, context) {
				if (context.toolCallId && session.state.nested.has(context.toolCallId)) return new Container();
				const id = context.toolCallId || `${name}:render`;
				set(updateRecord(session.state, id, name, args as Record<string, unknown>, (record) =>
					context.isError && record.status === "running" ? { ...record, status: "error" } : record));
				// The row reads the newest value on every render; after the run settles it keeps the final one.
				const seen = recordOf(session.state, id)!;
				const read = (): ActivityRecord => recordOf(session.state, id) ?? seen;
				const component = context.lastComponent instanceof ActivityRowComponent
					? context.lastComponent
					: new ActivityRowComponent(read, theme, () => session.state.density);
				component.update(read, theme);
				return component;
			},
			renderResult(result, options, theme, context) {
				if (context.toolCallId && session.state.nested.has(context.toolCallId)) return new Container();
				const id = context.toolCallId || `${name}:render`;
				set(updateRecord(session.state, id, name, context.args as Record<string, unknown>, (record) =>
					!options.isPartial || context.isError ? withToolResult(record, result, context.isError) : withPreview(record, result)));
				const record = recordOf(session.state, id);
				return renderExpandedToolResult(
					name,
					context.args as Record<string, unknown>,
					result,
					options.expanded,
					context.isError,
					context.showImages,
					theme,
					record,
				);
			},
		});
	}

	registerCompactTool(createReadTool);
	registerCompactTool(createBashTool);
	registerCompactTool(createEditTool);
	registerCompactTool(createWriteTool);
	registerCompactTool(createFindTool);
	registerCompactTool(createGrepTool);
	registerCompactTool(createLsTool);

	pi.registerCommand("activity", {
		description: "Inspect recent tool activity with filters for changes, commands, and issues.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/activity requires interactive TUI mode.", "error");
				return;
			}
			const { history, run } = session.state;
			const currentRecords = [...run.values()].filter((record) => !history.some((saved) => saved.id === record.id));
			const records = [...history, ...currentRecords].slice(-HISTORY_LIMIT);
			if (!records.length) {
				ctx.ui.notify("No activity has been recorded in this session yet.", "info");
				return;
			}
			await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
				return new ActivityInspectorComponent(records, theme, keybindings, () => done(), () => tui.requestRender());
			});
		},
	});

	pi.registerCommand("activity-settings", {
		description: "Choose minimal, balanced, or forensic activity-row density.",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (requested) {
				if (!isDensity(requested)) {
					if (ctx.hasUI) ctx.ui.notify("Usage: /activity-settings [minimal|balanced|forensic]", "error");
					return;
				}
				set({ ...session.state, density: requested });
				pi.appendEntry("activity-settings", { density: requested });
				if (ctx.mode === "tui") {
					ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `Activity · ${requested}`));
					ctx.ui.notify(`Activity density set to ${requested}.`, "info");
				}
				return;
			}
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("Pass a density: /activity-settings [minimal|balanced|forensic]", "error");
				return;
			}
			const items: SettingItem[] = [{
				id: "density",
				label: "Activity density",
				description: "Minimal hides metadata; balanced shows outcomes; forensic adds category and truncation evidence.",
				currentValue: session.state.density,
				values: [...DENSITIES],
			}];
			await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
				const container = new Container();
				container.addChild(new Text(theme.fg("accent", theme.bold("Activity settings")), 1, 1));
				const settings = new SettingsList(
					items,
					3,
					getSettingsListTheme(),
					(id, value) => {
						if (id !== "density" || !isDensity(value)) return;
						set({ ...session.state, density: value });
						settings.updateValue(id, value);
						pi.appendEntry("activity-settings", { density: value });
						ctx.ui.setStatus("pi-activity", theme.fg("dim", `Activity · ${value}`));
						tui.requestRender();
					},
					() => done(),
				);
				container.addChild(settings);
				container.addChild(new Text(theme.fg("dim", `${keyHint("tui.select.confirm", "change")} · ${keyHint("tui.select.cancel", "close")}`), 1, 1));
				return {
					render: (width) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						settings.handleInput(data);
						tui.requestRender();
					},
				};
			});
		},
	});

	pi.on("session_start", (_event, ctx) => {
		// Registered after the built-in codemode loads, so the built-in tool is replaced rather than skipped.
		if (!session.state.codemodeRegistered) {
			set({ ...session.state, codemodeRegistered: true });
			registerCompactCodemode(pi);
		}
		set(restoredFromBranch(
			{ ...withoutRun(session.state), nested: new Set(), waitingForUser: false, lastWorkingMessage: undefined },
			ctx.sessionManager.getBranch(),
		));
		if (ctx.mode !== "tui") return;
		ctx.ui.setToolsExpanded(false);
		ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `◇ ready · ${session.state.density}`));
	});

	pi.on("session_tree", (_event, ctx) => {
		set(restoredFromBranch(withoutRun(session.state), ctx.sessionManager.getBranch()));
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("pi-activity", undefined);
			setWorkingMessage(ctx, undefined);
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `◇ ready · ${session.state.density}`));
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		set({ ...session.state, active: new Set(), agentRunning: false, waitingForUser: false });
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget("pi-activity", undefined);
		ctx.ui.setStatus("pi-activity", undefined);
		setWorkingMessage(ctx, undefined);
	});

	pi.on("agent_start", (_event, ctx) => {
		set({
			...session.state,
			active: new Set(),
			agentRunning: true,
			waitingForUser: false,
			runStartedAt: session.state.runStartedAt ?? Date.now(),
		});
		refreshPresence(ctx);
	});

	pi.on("ui_prompt_start", (_event, ctx) => {
		set({ ...session.state, waitingForUser: true });
		refreshPresence(ctx);
	});

	pi.on("ui_prompt_end", (_event, ctx) => {
		set({ ...session.state, waitingForUser: false });
		refreshPresence(ctx);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		set(toolStarted(session.state, event as typeof event & { parentToolCallId?: string }, Date.now()));
		refreshPresence(ctx);
	});

	pi.on("tool_execution_update", (event) => {
		set(updateRecord(session.state, event.toolCallId, event.toolName, event.args ?? {}, (record) => withPreview(record, event.partialResult)));
	});

	pi.on("tool_result", (event) => {
		set(updateRecord(session.state, event.toolCallId, event.toolName, event.input ?? {}, (record) =>
			withToolResult(record, { content: event.content, details: event.details }, event.isError)));
	});

	pi.on("tool_execution_end", (event, ctx) => {
		set(toolEnded(session.state, event, Date.now()));
		refreshPresence(ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		set({ ...session.state, agentRunning: true });
		refreshPresence(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const settledAt = Date.now();
		const keepSummary = ctx.mode === "tui";
		const run = settled(session.state, settledAt, keepSummary);
		set(run.state);
		refreshPresence(ctx, true);

		const records = run.records.map(snapshotRecord);
		if (records.length && keepSummary) {
			const categoryCounts: Partial<Record<ActivityCategory, number>> = {};
			for (const record of records) categoryCounts[record.category] = (categoryCounts[record.category] ?? 0) + 1;
			const errors = records.filter((record) => record.status === "error");
			const cancelled = records.filter((record) => record.status === "cancelled");
			const data: ActivitySummaryData = {
				version: 2,
				startedAt: run.startedAt ?? records[0]!.startedAt,
				durationMs: Math.max(0, settledAt - (run.startedAt ?? records[0]!.startedAt)),
				actionCount: records.length,
				errorCount: errors.length,
				cancelledCount: cancelled.length,
				truncatedCount: records.filter((record) => record.truncated).length,
				modifiedFiles: aggregateFileChanges(records),
				completedActions: unique(records.filter((record) => record.status === "success").map((record) => record.name)),
				failedActions: unique([...errors, ...cancelled].map((record) => record.name)),
				categoryCounts,
				records,
			};
			pi.appendEntry("activity-summary", data);
			const issueCount = data.errorCount + data.cancelledCount;
			const status = issueCount
				? ctx.ui.theme.fg("warning", `! ${data.actionCount} actions · ${issueCount} issues · ${formatDuration(data.durationMs)}`)
				: ctx.ui.theme.fg("success", `✓ ${data.actionCount} actions · ${data.modifiedFiles.length} files · ${formatDuration(data.durationMs)}`);
			ctx.ui.setStatus("pi-activity", status);
		}
	});
}
