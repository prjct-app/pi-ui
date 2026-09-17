import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";
import type {
	ActivityCategory,
	ActivityRecord,
	ActivityRecordSnapshot,
	ActivityStatus,
	FileChange,
} from "./types.ts";

const INSPECTION_TOOLS = new Set(["read", "grep", "find", "ls"]);
const CHANGE_TOOLS = new Set(["edit", "write"]);
const VERIFY_COMMAND = /(?:^|[;&|]\s*|\b)(?:npm|pnpm|yarn|bun)\s+(?:(?:run|run-s|run-p)\s+)?(?:test|check|lint|build|typecheck|type-check)\b|(?:^|[;&|]\s*|\b)(?:pytest|vitest|jest|mocha|cargo\s+test|go\s+test|tsc\b)/i;

export const TOOL_VERBS: Record<string, string> = {
	bash: "RUN",
	read: "READ",
	edit: "EDIT",
	write: "WRITE",
	find: "FIND",
	grep: "SEARCH",
	ls: "LIST",
};

export function cleanDisplayText(value: string): string {
	return stripVTControlCharacters(value)
		.replace(/\r?\n/g, " ↵ ")
		.replace(/\t/g, " ")
		.replace(/[\x00-\x1f\x7f]/g, "");
}

export function actionTarget(name: string, args: Record<string, unknown>): string {
	const raw = name === "bash"
		? args.command
		: name === "grep" || name === "find"
			? `${args.pattern ?? ""}${args.path ? ` · ${args.path}` : ""}`
			: args.path;
	if (typeof raw !== "string" || !raw) return ".";
	const home = homedir();
	const target = raw.startsWith(`${home}/`) ? `~/${raw.slice(home.length + 1)}` : raw;
	return cleanDisplayText(target);
}

export function isVerificationCommand(command: unknown): boolean {
	return typeof command === "string" && VERIFY_COMMAND.test(command);
}

export function activityCategory(name: string, args: Record<string, unknown>): ActivityCategory {
	if (INSPECTION_TOOLS.has(name)) return "inspect";
	if (CHANGE_TOOLS.has(name)) return "change";
	if (name === "bash") return isVerificationCommand(args.command) ? "verify" : "execute";
	return "other";
}

/** The activity view shows at most this many result lines. */
export const PREVIEW_LINES = 5;
const PREVIEW_CHARS = 2_000;
/** Persisted history renders a target on one line; full heredoc commands reached 28KB each. */
const SNAPSHOT_TARGET_CHARS = 240;

/** First visible lines of a text, capped the way the old 2,000-character preview was. */
export function previewText(text: string): string {
	const lines = text.split("\n", PREVIEW_LINES).join("\n");
	return lines.length > PREVIEW_CHARS ? `${lines.slice(0, PREVIEW_CHARS - 3)}…` : lines;
}

/**
 * Preview of a (partial) tool result without joining its whole output. Streaming
 * updates arrive per chunk; joining and trimming up to 50KB each time made long
 * commands quadratic for a view that shows five lines.
 */
export function resultPreview(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	const budget = { chars: 0 };
	for (const item of content) {
		if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "text") continue;
		const text = (item as { text?: unknown }).text;
		if (typeof text !== "string") continue;
		const piece = text.slice(0, PREVIEW_CHARS * 2);
		parts.push(piece);
		budget.chars += piece.length;
		if (budget.chars >= PREVIEW_CHARS * 2) break;
	}
	return previewText(parts.join("\n").trimStart());
}

export function resultText(result: unknown): string {
	if (!result || typeof result !== "object") return "";
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item): item is { type: "text"; text: string } =>
			Boolean(item) && typeof item === "object" && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string",
		)
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function detailsOf(result: unknown): Record<string, unknown> | undefined {
	if (!result || typeof result !== "object") return undefined;
	const details = (result as { details?: unknown }).details;
	return details && typeof details === "object" ? details as Record<string, unknown> : undefined;
}

function countLines(text: string): number {
	if (!text) return 0;
	return text.replace(/\n$/, "").split("\n").length;
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
	return `${value} ${value === 1 ? singular : pluralForm}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "";
	if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
	if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	return `${minutes}m ${seconds}s`;
}

export function parseDiffStats(diff: string | undefined): { additions: number; deletions: number } {
	if (!diff) return { additions: 0, deletions: 0 };
	let additions = 0;
	let deletions = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}
	return { additions, deletions };
}

function grepMatchCount(text: string): number {
	const lines = text.split("\n").filter((line) => line.trim() && line.trim() !== "--");
	const formattedMatches = lines.filter((line) => /(?:^|:|-)\d+(?::|-)/.test(line));
	return formattedMatches.length || lines.length;
}

function listCount(text: string): number {
	return text.split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("[")).length;
}

function compactError(text: string): string | undefined {
	const lines = text.split("\n").map((line) => cleanDisplayText(line.trim())).filter(Boolean);
	if (!lines.length) return undefined;
	const joined = lines.slice(-3).join(" · ");
	return joined.length > 320 ? `${joined.slice(0, 317)}…` : joined;
}

function truncationState(result: unknown): boolean {
	const details = detailsOf(result);
	const truncation = details?.truncation;
	return Boolean(
		truncation && typeof truncation === "object" && (truncation as { truncated?: unknown }).truncated,
	) || Boolean(details?.matchLimitReached || details?.resultLimitReached || details?.entryLimitReached || details?.linesTruncated);
}

function statusFromResult(isError: boolean, text: string): Exclude<ActivityStatus, "running"> {
	if (!isError) return "success";
	return /\b(?:aborted|cancelled|canceled|interrupted)\b/i.test(text) ? "cancelled" : "error";
}

function verificationOutcome(command: unknown, output: string): string {
	const passed = output.match(/\b(\d+)\s+(?:tests?\s+)?passed\b/i)?.[1]
		?? output.match(/^#\s*pass\s+(\d+)\s*$/im)?.[1];
	if (passed) return `${passed} passed`;
	if (typeof command === "string" && /\b(?:lint|eslint|biome)\b/i.test(command)) return "lint clean";
	if (typeof command === "string" && /\b(?:typecheck|type-check|tsc)\b/i.test(command)) return "types clean";
	if (typeof command === "string" && /\bbuild\b/i.test(command)) return "build passed";
	return "verified";
}

function outcomeFor(
	name: string,
	args: Record<string, unknown>,
	result: unknown,
	status: Exclude<ActivityStatus, "running">,
): { outcome: string; change?: FileChange } {
	const text = resultText(result);
	const details = detailsOf(result);
	if (status === "cancelled") return { outcome: "cancelled" };
	if (status === "error") {
		const exitCode = text.match(/exited with code\s+(\d+)/i)?.[1];
		if (exitCode) return { outcome: `exit ${exitCode}` };
		if (/timed out/i.test(text)) return { outcome: "timed out" };
		return { outcome: "failed" };
	}

	switch (name) {
		case "read": {
			const truncation = details?.truncation as { outputLines?: number } | undefined;
			const lines = truncation?.outputLines ?? countLines(text);
			return { outcome: plural(lines, "line") };
		}
		case "grep": {
			if (/^no matches found$/i.test(text)) return { outcome: "no matches" };
			const matches = grepMatchCount(text);
			return { outcome: matches ? plural(matches, "match", "matches") : "no matches" };
		}
		case "find": {
			if (/^no files found/i.test(text)) return { outcome: "no results" };
			const results = listCount(text);
			return { outcome: results ? plural(results, "result") : "no results" };
		}
		case "ls": {
			if (/^\(?empty directory\)?$/i.test(text)) return { outcome: "empty" };
			const entries = listCount(text);
			return { outcome: entries ? plural(entries, "entry", "entries") : "empty" };
		}
		case "edit": {
			const edits = Array.isArray(args.edits) ? args.edits.length : 1;
			const diff = typeof details?.diff === "string" ? details.diff : undefined;
			const stats = parseDiffStats(diff);
			const path = typeof args.path === "string" ? args.path : ".";
			const change: FileChange = {
				path,
				kind: "edit",
				actions: 1,
				additions: stats.additions,
				deletions: stats.deletions,
			};
			const delta = stats.additions || stats.deletions ? ` · +${stats.additions} −${stats.deletions}` : "";
			return { outcome: `${plural(edits, "block")}${delta}`, change };
		}
		case "write": {
			const content = typeof args.content === "string" ? args.content : "";
			const lines = countLines(content);
			const bytes = Buffer.byteLength(content);
			const path = typeof args.path === "string" ? args.path : ".";
			return {
				outcome: `${plural(lines, "line")} · ${formatBytes(bytes)}`,
				change: { path, kind: "write", actions: 1, lines, bytes },
			};
		}
		case "bash":
			return { outcome: isVerificationCommand(args.command) ? verificationOutcome(args.command, text) : "exit 0" };
		default:
			return { outcome: "completed" };
	}
}

export function applyToolResult(record: ActivityRecord, result: unknown, isError: boolean): void {
	const text = resultText(result);
	const status = statusFromResult(isError, text);
	const derived = outcomeFor(record.name, record.args, result, status);
	record.status = status;
	record.outcome = derived.outcome;
	record.change = derived.change;
	record.truncated = truncationState(result);
	record.outputPreview = previewText(text);
	if (status === "error" || status === "cancelled") record.errorMessage = compactError(text);
}

export function finishRecord(record: ActivityRecord, endedAt: number, result: unknown, isError: boolean): void {
	record.endedAt = endedAt;
	record.durationMs = Math.max(0, endedAt - record.startedAt);
	applyToolResult(record, result, isError);
}

export function snapshotRecord(record: ActivityRecord): ActivityRecordSnapshot {
	const status = record.status === "running" ? "cancelled" : record.status;
	return {
		id: record.id,
		name: record.name,
		target: record.target.length > SNAPSHOT_TARGET_CHARS ? `${record.target.slice(0, SNAPSHOT_TARGET_CHARS - 1)}…` : record.target,
		category: record.category,
		status,
		startedAt: record.startedAt,
		durationMs: record.durationMs ?? Math.max(0, Date.now() - record.startedAt),
		outcome: record.outcome,
		truncated: record.truncated || undefined,
		change: record.change,
		errorMessage: record.errorMessage,
	};
}

export function aggregateFileChanges(records: readonly ActivityRecordSnapshot[]): FileChange[] {
	const files = new Map<string, FileChange>();
	for (const record of records) {
		if (record.status !== "success" || !record.change) continue;
		const change = record.change;
		const existing = files.get(change.path);
		if (!existing) {
			files.set(change.path, { ...change });
			continue;
		}
		existing.actions += change.actions;
		existing.kind = existing.kind === "write" || change.kind === "write" ? "write" : "edit";
		if (change.additions !== undefined) existing.additions = (existing.additions ?? 0) + change.additions;
		if (change.deletions !== undefined) existing.deletions = (existing.deletions ?? 0) + change.deletions;
		if (change.lines !== undefined) existing.lines = change.lines;
		if (change.bytes !== undefined) existing.bytes = change.bytes;
	}
	return [...files.values()];
}
