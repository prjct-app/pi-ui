import { actionTarget, activityCategory, resultText, withFinish, withToolResult } from "./format.ts";
import type { ActivityDensity, ActivityRecord, ActivityRecordSnapshot, ActivitySummaryData } from "./types.ts";

export const DENSITIES: readonly ActivityDensity[] = ["minimal", "balanced", "forensic"];
export const HISTORY_LIMIT = 200;
const NESTED_LIMIT = 5000;

export function isDensity(value: unknown): value is ActivityDensity {
	return typeof value === "string" && DENSITIES.includes(value as ActivityDensity);
}

/**
 * Everything pi-activity knows, as one immutable value. Every event produces a new value from the
 * previous one; nothing is changed in place.
 */
export type ActivityState = Readonly<{
	codemodeRegistered: boolean;
	density: ActivityDensity;
	runStartedAt: number | undefined;
	agentRunning: boolean;
	waitingForUser: boolean;
	lastWorkingMessage: string | undefined;
	/** Saved summaries of earlier runs, restored from the session. */
	history: readonly (ActivityRecord | ActivityRecordSnapshot)[];
	/** This run's records by tool call id, in the order they started. */
	run: ReadonlyMap<string, ActivityRecord>;
	/** Tool calls executing now, in the order they started. */
	active: ReadonlySet<string>;
	/** Final records of settled runs, so their transcript rows keep rendering the last value. */
	past: ReadonlyMap<string, ActivityRecord>;
	/** Calls a tool makes itself (codemode scripts); their parent shows them. */
	nested: ReadonlySet<string>;
}>;

export const initialState = (): ActivityState => ({
	codemodeRegistered: false,
	density: "balanced",
	runStartedAt: undefined,
	agentRunning: false,
	waitingForUser: false,
	lastWorkingMessage: undefined,
	history: [],
	run: new Map(),
	active: new Set(),
	past: new Map(),
	nested: new Set(),
});

const lastEntries = <K, V>(entries: Iterable<readonly [K, V]>, limit: number): ReadonlyMap<K, V> =>
	new Map([...new Map(entries)].slice(-limit));

/** The record for a tool call: from this run, from a settled run, or undefined. */
export const recordOf = (state: ActivityState, id: string): ActivityRecord | undefined =>
	state.run.get(id) ?? state.past.get(id);

export const activeRecords = (state: ActivityState): ActivityRecord[] =>
	[...state.active].flatMap((id) => state.run.get(id) ?? []);

export const completedCount = (state: ActivityState): number =>
	[...state.run.values()].filter((record) => record.status !== "running").length;

const putRecord = (state: ActivityState, record: ActivityRecord): ActivityState => ({
	...state,
	run: new Map([...state.run, [record.id, record]]),
});

/** Makes sure this run has a record for the call; new args refresh its target and category. */
export function withRecord(
	state: ActivityState,
	id: string,
	name: string,
	args: Record<string, unknown> = {},
	startedAt = Date.now(),
): ActivityState {
	const existing = state.run.get(id);
	if (existing) {
		return Object.keys(args).length
			? putRecord(state, { ...existing, args, target: actionTarget(name, args), category: activityCategory(name, args) })
			: state;
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
	return { ...putRecord(state, record), runStartedAt: state.runStartedAt ?? startedAt };
}

/** Applies `change` to the call's record, creating the record first when needed. */
export function updateRecord(
	state: ActivityState,
	id: string,
	name: string,
	args: Record<string, unknown> | undefined,
	change: (record: ActivityRecord) => ActivityRecord,
	startedAt = Date.now(),
): ActivityState {
	const ensured = withRecord(state, id, name, args, startedAt);
	return putRecord(ensured, change(ensured.run.get(id)!));
}

export const withPreview = (record: ActivityRecord, partial: unknown): ActivityRecord => {
	const preview = resultText(partial);
	return preview ? { ...record, outputPreview: preview.slice(0, 2_000) } : record;
};

export function toolStarted(
	state: ActivityState,
	event: { toolCallId: string; toolName: string; args?: Record<string, unknown>; parentToolCallId?: string },
	now: number,
): ActivityState {
	// parentToolCallId is set by Pi 1.1.0+; older hosts never send it, so nothing is hidden there.
	const nested = event.parentToolCallId
		? new Set([...(state.nested.size > NESTED_LIMIT ? [] : state.nested), event.toolCallId])
		: state.nested;
	const started = updateRecord(
		{ ...state, agentRunning: true, nested },
		event.toolCallId,
		event.toolName,
		event.args ?? {},
		(record) => ({ ...record, status: "running", startedAt: now, endedAt: undefined, durationMs: undefined }),
		now,
	);
	return { ...started, active: new Set([...state.active, event.toolCallId]) };
}

export function toolEnded(
	state: ActivityState,
	event: { toolCallId: string; toolName: string; result?: unknown; isError: boolean },
	now: number,
): ActivityState {
	const ended = updateRecord(state, event.toolCallId, event.toolName, undefined, (record) => {
		if (event.result) return withFinish(record, now, event.result, event.isError);
		const timed = { ...record, endedAt: now, durationMs: Math.max(0, now - record.startedAt) };
		return timed.status === "running" ? withToolResult(timed, { content: [] }, event.isError) : timed;
	});
	return { ...ended, active: new Set([...state.active].filter((id) => id !== event.toolCallId)) };
}

/** Fresh run, for a new session or a jump in the session tree. */
export const withoutRun = (state: ActivityState): ActivityState => ({
	...state,
	run: new Map(),
	active: new Set(),
	past: new Map(),
	runStartedAt: undefined,
	agentRunning: false,
});

/** Density and history saved in the session branch. */
export function restoredFromBranch(
	state: ActivityState,
	entries: readonly { type: string; customType?: string; data?: unknown }[],
): ActivityState {
	const custom = entries.filter((entry) => entry.type === "custom");
	const density = custom
		.filter((entry) => entry.customType === "activity-settings")
		.map((entry) => (entry.data as { density?: unknown } | undefined)?.density)
		.filter(isDensity)
		.at(-1) ?? "balanced";
	const records = custom
		.filter((entry) => entry.customType === "activity-summary")
		.map((entry) => entry.data as Partial<ActivitySummaryData> | undefined)
		.flatMap((data) => (data?.version === 2 && Array.isArray(data.records) ? data.records : []));
	return { ...state, density, history: [...lastEntries(records.map((record) => [record.id, record] as const), HISTORY_LIMIT).values()] };
}

export type SettledRun = Readonly<{ state: ActivityState; records: readonly ActivityRecord[]; startedAt: number | undefined }>;

/** Closes the run: calls still running count as interrupted, and the run moves to `past`. */
export function settled(state: ActivityState, now: number, keepHistory: boolean): SettledRun {
	const records = [...state.run.values()].map((record) =>
		record.status === "running"
			? { ...record, status: "cancelled" as const, outcome: "interrupted", endedAt: now, durationMs: Math.max(0, now - record.startedAt) }
			: record,
	);
	return {
		records,
		startedAt: state.runStartedAt,
		state: {
			...state,
			agentRunning: false,
			waitingForUser: false,
			active: new Set(),
			run: new Map(),
			runStartedAt: undefined,
			past: lastEntries([...state.past, ...records.map((record) => [record.id, record] as const)], HISTORY_LIMIT),
			history: keepHistory && records.length ? [...state.history, ...records].slice(-HISTORY_LIMIT) : state.history,
		},
	};
}
