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
import {
	actionTarget,
	activityCategory,
	aggregateFileChanges,
	applyToolResult,
	finishRecord,
	formatDuration,
	resultText,
	snapshotRecord,
	TOOL_VERBS,
} from "./format.ts";
import type {
	ActivityCategory,
	ActivityDensity,
	ActivityRecord,
	ActivityRecordSnapshot,
	ActivitySummaryData,
} from "./types.ts";

const DENSITIES: ActivityDensity[] = ["minimal", "balanced", "forensic"];
const HISTORY_LIMIT = 200;

function isDensity(value: unknown): value is ActivityDensity {
	return typeof value === "string" && DENSITIES.includes(value as ActivityDensity);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

export default function activityMode(pi: ExtensionAPI) {
	let density: ActivityDensity = "balanced";
	let runStartedAt: number | undefined;
	let agentRunning = false;
	let waitingForUser = false;
	let lastWorkingMessage: string | undefined;
	let history: Array<ActivityRecord | ActivityRecordSnapshot> = [];
	let runRecords: ActivityRecord[] = [];
	const recordsById = new Map<string, ActivityRecord>();
	const activeRecords = new Map<string, ActivityRecord>();

	const completedCount = () => runRecords.filter((record) => record.status !== "running").length;

	function ensureRecord(
		id: string,
		name: string,
		args: Record<string, unknown> = {},
		startedAt = Date.now(),
	): ActivityRecord {
		const existing = recordsById.get(id);
		if (existing) {
			if (Object.keys(args).length) {
				existing.args = args;
				existing.target = actionTarget(name, args);
				existing.category = activityCategory(name, args);
			}
			return existing;
		}
		const record: ActivityRecord = {
			id,
			name,
			args,
			target: actionTarget(name, args),
			category: activityCategory(name, args),
			status: "running",
			startedAt,
		};
		recordsById.set(id, record);
		runRecords.push(record);
		runStartedAt ??= startedAt;
		return record;
	}

	function reconstructSessionState(ctx: ExtensionContext): void {
		density = "balanced";
		history = [];
		const byId = new Map<string, ActivityRecordSnapshot>();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom") continue;
			if (entry.customType === "activity-settings") {
				const savedDensity = (entry.data as { density?: unknown } | undefined)?.density;
				if (isDensity(savedDensity)) density = savedDensity;
			}
			if (entry.customType !== "activity-summary") continue;
			const data = entry.data as Partial<ActivitySummaryData> | undefined;
			if (data?.version !== 2 || !Array.isArray(data.records)) continue;
			for (const record of data.records) byId.set(record.id, record);
		}
		history = [...byId.values()].slice(-HISTORY_LIMIT);
	}

	function activeList(): ActivityRecord[] {
		return [...activeRecords.values()];
	}

	function setWorkingMessage(ctx: ExtensionContext, message: string | undefined): void {
		if (message === lastWorkingMessage) return;
		lastWorkingMessage = message;
		ctx.ui.setWorkingMessage(message);
	}

	function refreshPresence(ctx: ExtensionContext, settled = false): void {
		if (ctx.mode !== "tui") return;
		const records = activeList();
		if (settled) {
			ctx.ui.setWidget("pi-activity", undefined);
			setWorkingMessage(ctx, undefined);
			return;
		}

		if (waitingForUser || records.length) {
			ctx.ui.setWidget(
				"pi-activity",
				(_tui, theme) => new ActiveToolsWidget(activeList, completedCount, () => waitingForUser, theme),
				{ placement: "aboveEditor" },
			);
		} else {
			ctx.ui.setWidget("pi-activity", undefined);
		}

		if (waitingForUser) {
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
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("accent", `◆ ${records.length} active · ${completedCount()} done`));
			return;
		}
		if (agentRunning) {
			setWorkingMessage(ctx, "Thinking…");
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", "◆ thinking"));
		} else {
			setWorkingMessage(ctx, undefined);
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `◇ ready · ${density}`));
		}
	}

	pi.registerEntryRenderer("activity-summary", (entry, options, theme) => {
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
				const id = context.toolCallId || `${name}:render`;
				const record = ensureRecord(id, name, args as Record<string, unknown>);
				if (context.isError && record.status === "running") record.status = "error";
				const component = context.lastComponent instanceof ActivityRowComponent
					? context.lastComponent
					: new ActivityRowComponent(record, theme, () => density);
				component.update(record, theme);
				return component;
			},
			renderResult(result, options, theme, context) {
				const id = context.toolCallId || `${name}:render`;
				const record = ensureRecord(id, name, context.args as Record<string, unknown>);
				if (!options.isPartial || context.isError) applyToolResult(record, result, context.isError);
				else {
					const preview = resultText(result);
					if (preview) record.outputPreview = preview.slice(0, 2_000);
				}
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
			const currentRecords = runRecords.filter((record) => !history.some((saved) => saved.id === record.id));
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
				density = requested;
				pi.appendEntry("activity-settings", { density });
				if (ctx.mode === "tui") {
					ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `Activity · ${density}`));
					ctx.ui.notify(`Activity density set to ${density}.`, "info");
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
				currentValue: density,
				values: DENSITIES,
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
						density = value;
						settings.updateValue(id, value);
						pi.appendEntry("activity-settings", { density });
						ctx.ui.setStatus("pi-activity", theme.fg("dim", `Activity · ${density}`));
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
		runStartedAt = undefined;
		agentRunning = false;
		waitingForUser = false;
		lastWorkingMessage = undefined;
		runRecords = [];
		recordsById.clear();
		activeRecords.clear();
		reconstructSessionState(ctx);
		if (ctx.mode !== "tui") return;
		ctx.ui.setToolsExpanded(false);
		ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `◇ ready · ${density}`));
	});

	pi.on("session_tree", (_event, ctx) => {
		activeRecords.clear();
		recordsById.clear();
		runRecords = [];
		runStartedAt = undefined;
		agentRunning = false;
		reconstructSessionState(ctx);
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("pi-activity", undefined);
			setWorkingMessage(ctx, undefined);
			ctx.ui.setStatus("pi-activity", ctx.ui.theme.fg("dim", `◇ ready · ${density}`));
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		activeRecords.clear();
		agentRunning = false;
		waitingForUser = false;
		if (ctx.mode !== "tui") return;
		ctx.ui.setWidget("pi-activity", undefined);
		ctx.ui.setStatus("pi-activity", undefined);
		setWorkingMessage(ctx, undefined);
	});

	pi.on("agent_start", (_event, ctx) => {
		activeRecords.clear();
		agentRunning = true;
		waitingForUser = false;
		runStartedAt ??= Date.now();
		refreshPresence(ctx);
	});

	pi.on("ui_prompt_start", (_event, ctx) => {
		waitingForUser = true;
		refreshPresence(ctx);
	});

	pi.on("ui_prompt_end", (_event, ctx) => {
		waitingForUser = false;
		refreshPresence(ctx);
	});

	pi.on("tool_execution_start", (event, ctx) => {
		agentRunning = true;
		const record = ensureRecord(event.toolCallId, event.toolName, event.args ?? {}, Date.now());
		record.status = "running";
		record.startedAt = Date.now();
		record.endedAt = undefined;
		record.durationMs = undefined;
		activeRecords.set(event.toolCallId, record);
		refreshPresence(ctx);
	});

	pi.on("tool_execution_update", (event) => {
		const record = ensureRecord(event.toolCallId, event.toolName, event.args ?? {});
		const preview = resultText(event.partialResult);
		if (preview) record.outputPreview = preview.slice(0, 2_000);
	});

	pi.on("tool_result", (event) => {
		const record = ensureRecord(event.toolCallId, event.toolName, event.input ?? {});
		applyToolResult(record, { content: event.content, details: event.details }, event.isError);
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const record = ensureRecord(event.toolCallId, event.toolName);
		if (event.result) {
			finishRecord(record, Date.now(), event.result, event.isError);
		} else {
			record.endedAt = Date.now();
			record.durationMs = Math.max(0, record.endedAt - record.startedAt);
			if (record.status === "running") applyToolResult(record, { content: [] }, event.isError);
		}
		activeRecords.delete(event.toolCallId);
		refreshPresence(ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		agentRunning = true;
		refreshPresence(ctx);
	});

	pi.on("agent_settled", (_event, ctx) => {
		const settledAt = Date.now();
		agentRunning = false;
		for (const record of runRecords) {
			if (record.status !== "running") continue;
			record.status = "cancelled";
			record.outcome = "interrupted";
			record.endedAt = settledAt;
			record.durationMs = Math.max(0, settledAt - record.startedAt);
		}
		activeRecords.clear();
		waitingForUser = false;
		refreshPresence(ctx, true);

		const records = runRecords.map(snapshotRecord);
		if (records.length && ctx.mode === "tui") {
			const categoryCounts: Partial<Record<ActivityCategory, number>> = {};
			for (const record of records) categoryCounts[record.category] = (categoryCounts[record.category] ?? 0) + 1;
			const errors = records.filter((record) => record.status === "error");
			const cancelled = records.filter((record) => record.status === "cancelled");
			const data: ActivitySummaryData = {
				version: 2,
				startedAt: runStartedAt ?? records[0]!.startedAt,
				durationMs: Math.max(0, settledAt - (runStartedAt ?? records[0]!.startedAt)),
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
			history = [...history, ...runRecords].slice(-HISTORY_LIMIT);
			const issueCount = data.errorCount + data.cancelledCount;
			const status = issueCount
				? ctx.ui.theme.fg("warning", `! ${data.actionCount} actions · ${issueCount} issues · ${formatDuration(data.durationMs)}`)
				: ctx.ui.theme.fg("success", `✓ ${data.actionCount} actions · ${data.modifiedFiles.length} files · ${formatDuration(data.durationMs)}`);
			ctx.ui.setStatus("pi-activity", status);
		}

		runRecords = [];
		recordsById.clear();
		runStartedAt = undefined;
	});
}
