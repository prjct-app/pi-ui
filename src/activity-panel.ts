import { SYMBOL, ago, type PanelItem, type PanelSpec, type Tone } from "@prjct.app/pi-tui-kit";
import { cleanDisplayText, formatBytes, formatDuration, PREVIEW_LINES, TOOL_VERBS } from "./format.ts";
import type { ActivityDensity, ActivityRecord, ActivityRecordSnapshot, FileChange } from "./types.ts";

type Inspectable = ActivityRecord | ActivityRecordSnapshot;
const FILTERS = ["all", "changes", "commands", "issues"] as const;
type Filter = (typeof FILTERS)[number];
const DENSITIES: readonly ActivityDensity[] = ["minimal", "balanced", "forensic"];

const MARK: Record<Inspectable["status"], [string, Tone]> = {
	running: [SYMBOL.active, "accent"],
	success: [SYMBOL.ok, "success"],
	error: [SYMBOL.error, "error"],
	cancelled: [SYMBOL.idle, "warning"],
};

const verb = (record: Inspectable): string => TOOL_VERBS[record.name] ?? record.name.toUpperCase();
const duration = (record: Inspectable): number | undefined =>
	record.durationMs ?? (record.status === "running" ? Math.max(0, Date.now() - record.startedAt) : undefined);
const count = (value: number, word: string): string => `${value} ${word}${value === 1 ? "" : "s"}`;

function changeText(change: FileChange): string {
	if (change.kind === "write") {
		return [change.lines === undefined ? undefined : count(change.lines, "line"), change.bytes === undefined ? undefined : formatBytes(change.bytes)]
			.filter(Boolean).join(" · ");
	}
	return `+${change.additions ?? 0} −${change.deletions ?? 0}`;
}

function keep(record: Inspectable, filter: Filter): boolean {
	if (filter === "changes") return record.category === "change";
	if (filter === "commands") return record.name === "bash";
	if (filter === "issues") return record.status === "error" || record.status === "cancelled" || record.truncated === true;
	return true;
}

/** The full input for traceability: the whole command or the path and range. */
function input(record: Inspectable): string[] {
	if (!("args" in record)) return [];
	const args = record.args ?? {};
	if (typeof args.command === "string") return cleanDisplayText(args.command.slice(0, 4000)).split(" ↵ ");
	return Object.entries(args)
		.filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
		.slice(0, 8)
		.map(([key, value]) => `${key}: ${cleanDisplayText(String(value).slice(0, 300))}`);
}

/**
 * /activity: every tool call this session made, newest first, with what it
 * changed, how it ended and its full input and output preview.
 */
export function activityPanelSpec(options: {
	records: () => Inspectable[];
	density: () => ActivityDensity;
	setDensity: (density: ActivityDensity) => void;
}): PanelSpec {
	const state = { filter: "all" as Filter };
	const all = () => [...options.records()].reverse();
	return {
		title: "Activity",
		summary: () => {
			const records = options.records();
			const issues = records.filter((record) => keep(record, "issues")).length;
			const changed = records.filter((record) => record.category === "change").length;
			return `${count(records.length, "action")} · ${changed} changed · ${count(issues, "issue")} · ${state.filter}`;
		},
		items: () => all().filter((record) => keep(record, state.filter)).map((record): PanelItem => {
			const [symbol, tone] = MARK[record.status];
			const took = duration(record);
			return {
				id: record.id,
				label: `${verb(record).padEnd(6)} ${record.target}`,
				symbol,
				tone,
				meta: [record.status === "running" ? undefined : record.outcome, took === undefined ? undefined : formatDuration(took)].filter(Boolean).join(" · "),
				search: `${record.name} ${record.category} ${record.status}`,
			};
		}),
		detail: (item) => {
			const record = all().find((entry) => entry.id === item.id)!;
			const took = duration(record);
			const preview = "outputPreview" in record && record.outputPreview ? record.outputPreview.split("\n").slice(0, PREVIEW_LINES * 2) : [];
			return {
				title: `${verb(record)} ${record.target}`,
				subtitle: `${record.status}${record.outcome ? ` · ${record.outcome}` : ""}`,
				subtitleTone: MARK[record.status][1],
				fields: [
					{ label: "tool", value: record.name },
					{ label: "category", value: record.category },
					{ label: "started", value: ago(record.startedAt) },
					{ label: "took", value: took === undefined ? "—" : formatDuration(took) },
					...(record.change ? [{ label: "changed", value: `${cleanDisplayText(record.change.path)} · ${changeText(record.change)}` }] : []),
					...(record.truncated ? [{ label: "output", value: "truncated", tone: "warning" as Tone }] : []),
					...(record.errorMessage ? [{ label: "error", value: cleanDisplayText(record.errorMessage), tone: "error" as Tone }] : []),
					{ label: "id", value: record.id },
				],
				sections: [
					...(input(record).length ? [{ title: "Input", lines: input(record) }] : []),
					...(preview.length ? [{ title: "Output", lines: preview.map((line) => cleanDisplayText(line)) }] : []),
				],
			};
		},
		actions: [
			{
				key: "f",
				label: () => `Filter: ${state.filter}`,
				run: (_item, panel) => {
					state.filter = FILTERS[(FILTERS.indexOf(state.filter) + 1) % FILTERS.length]!;
					panel.refresh();
				},
			},
			{
				key: "v",
				label: () => `Rows: ${options.density()}`,
				run: (_item, panel) => {
					const next = DENSITIES[(DENSITIES.indexOf(options.density()) + 1) % DENSITIES.length]!;
					options.setDensity(next);
					panel.notice(`Transcript rows now ${next}.`, "success");
				},
			},
		],
		empty: "No tool activity in this session yet.",
		refreshMs: 1000,
	};
}
