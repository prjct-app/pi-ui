import {
	getLanguageFromPath,
	highlightCode,
	keyHint,
	renderDiff,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	Image,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
} from "@earendil-works/pi-tui";
import {
	cleanDisplayText,
	formatBytes,
	formatDuration,
	groupedActionLabels,
	groupedActiveLines,
	PREVIEW_LINES,
	resultText,
	TOOL_VERBS,
} from "./format.ts";
import type {
	ActivityDensity,
	ActivityRecord,
	ActivityRecordSnapshot,
	ActivityStatus,
	ActivitySummaryData,
	FileChange,
	LegacyActivitySummaryData,
} from "./types.ts";

const STATUS_PRESENTATION: Record<ActivityStatus, { symbol: string; color: "accent" | "success" | "error" | "warning" }> = {
	running: { symbol: "◆", color: "accent" },
	success: { symbol: "✓", color: "success" },
	error: { symbol: "✕", color: "error" },
	cancelled: { symbol: "◇", color: "warning" },
};

function safeLine(line: string, width: number): string {
	if (width <= 0) return "";
	return truncateToWidth(line, width, "…");
}

function joinColumns(left: string, right: string, width: number, minimumLeft = 18): string {
	if (!right) return safeLine(left, width);
	const rightWidth = visibleWidth(right);
	if (width < minimumLeft + rightWidth + 2) return safeLine(`${left}  ${right}`, width);
	const leftWidth = Math.max(minimumLeft, width - rightWidth - 2);
	const clippedLeft = truncateToWidth(left, leftWidth, "…");
	const padding = " ".repeat(Math.max(2, width - visibleWidth(clippedLeft) - rightWidth));
	return safeLine(`${clippedLeft}${padding}${right}`, width);
}

function recordDuration(record: ActivityRecord | ActivityRecordSnapshot): number | undefined {
	if ("durationMs" in record && record.durationMs !== undefined) return record.durationMs;
	// Rows rebuilt from history (resume, /reload) have a result but no measured
	// duration. Counting from when the row was rebuilt showed a clock that never
	// stopped and changed every row on every frame, defeating the render cache.
	if (record.status !== "running") return undefined;
	return Math.max(0, Date.now() - record.startedAt);
}

function metadataFor(record: ActivityRecord, density: ActivityDensity): string {
	const duration = formatDuration(recordDuration(record));
	const outcome = record.status === "running" ? duration : record.outcome;
	if (density === "minimal") {
		return record.status === "error" || record.status === "cancelled" ? outcome ?? "" : "";
	}
	const parts = [outcome];
	if (record.status !== "running" && duration) parts.push(duration);
	if (density === "forensic") {
		parts.push(record.category);
		if (record.truncated) parts.push("truncated");
	}
	return parts.filter(Boolean).join(" · ");
}

export class HiddenActivityComponent implements Component {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

export const HIDDEN_ACTIVITY = new HiddenActivityComponent();

export class ActivityRowComponent implements Component {
	private record: ActivityRecord;
	private theme: Theme;
	private density: () => ActivityDensity;

	constructor(record: ActivityRecord, theme: Theme, density: () => ActivityDensity) {
		this.record = record;
		this.theme = theme;
		this.density = density;
	}

	private cache?: { key: string; lines: string[] };

	update(record: ActivityRecord, theme: Theme): void {
		this.record = record;
		this.theme = theme;
		this.cache = undefined;
	}

	render(width: number): string[] {
		// Fullscreen mode renders the whole transcript every frame; without this
		// cache every historical row re-measured its text on each spinner tick.
		const { name, status, target } = this.record;
		const key = `${width}\0${name}\0${status}\0${target}\0${metadataFor(this.record, this.density())}`;
		if (this.cache?.key === key) return this.cache.lines;
		const lines = this.renderRow(width);
		this.cache = { key, lines };
		return lines;
	}

	private renderRow(width: number): string[] {
		const presentation = STATUS_PRESENTATION[this.record.status];
		const symbol = this.theme.fg(presentation.color, presentation.symbol);
		const verbText = (TOOL_VERBS[this.record.name] ?? this.record.name.toUpperCase()).slice(0, 8).padEnd(8);
		const verb = this.theme.fg("toolTitle", this.theme.bold(verbText));
		const target = this.theme.fg("toolOutput", this.record.target);
		const left = `${symbol} ${verb}${target}`;
		const metadata = metadataFor(this.record, this.density());
		const rightColor = this.record.status === "error"
			? "error"
			: this.record.status === "cancelled"
				? "warning"
				: "dim";
		const right = metadata ? this.theme.fg(rightColor, metadata) : "";
		return [joinColumns(left, right, width, 22)];
	}

	invalidate(): void {
		this.cache = undefined;
	}
}

export class ActiveToolsWidget implements Component {
	private readonly getRecords: () => ActivityRecord[];
	private readonly isWaiting: () => boolean;
	private theme: Theme;

	constructor(
		getRecords: () => ActivityRecord[],
		isWaiting: () => boolean,
		theme: Theme,
	) {
		this.getRecords = getRecords;
		this.isWaiting = isWaiting;
		this.theme = theme;
	}

	render(width: number): string[] {
		if (this.isWaiting()) {
			return [safeLine(`${this.theme.fg("warning", "!")} ${this.theme.fg("muted", "Waiting for input")}`, width)];
		}
		const records = this.getRecords();
		if (!records.length) return [];
		const grouped = groupedActiveLines(records);
		return [safeLine(`${this.theme.fg("accent", "◆")} ${this.theme.fg("muted", grouped.header)}`, width)];
	}

	invalidate(): void {}
}

function count(value: number, singular: string, plural = `${singular}s`): string {
	return `${value} ${value === 1 ? singular : plural}`;
}

function changeStats(change: FileChange): string {
	if (change.kind === "write") {
		const parts = [change.lines === undefined ? undefined : count(change.lines, "line")];
		if (change.bytes !== undefined) parts.push(formatBytes(change.bytes));
		return parts.filter(Boolean).join(" · ");
	}
	return `+${change.additions ?? 0} −${change.deletions ?? 0}`;
}

function isVersionTwo(data: ActivitySummaryData | LegacyActivitySummaryData): data is ActivitySummaryData {
	return (data as { version?: unknown }).version === 2;
}

export class ActivitySummaryComponent implements Component {
	constructor(
		private readonly data: ActivitySummaryData | LegacyActivitySummaryData,
		private readonly expanded: boolean,
		private readonly theme: Theme,
	) {}

	render(width: number): string[] {
		if (!isVersionTwo(this.data)) return this.renderLegacy(width);
		const data = this.data;
		const issueCount = data.errorCount + data.cancelledCount;
		const successfulVerification = data.records.some((record) => record.category === "verify" && record.status === "success");
		const symbol = issueCount ? "!" : "✓";
		const symbolColor = issueCount ? "warning" : "success";
		const groups = groupedActionLabels(data.records);
		const middle = [
			...groups,
			data.modifiedFiles.length ? count(data.modifiedFiles.length, "file") : undefined,
			issueCount ? count(issueCount, "issue") : successfulVerification ? "verified" : undefined,
			formatDuration(data.durationMs),
		].filter(Boolean).join(" · ");
		const title = `${this.theme.fg(symbolColor, symbol)} ${this.theme.fg("customMessageLabel", this.theme.bold(this.expanded ? "Activity report" : "Activity"))} ${this.theme.fg("muted", `· ${middle}`)}`;
		if (!this.expanded) return [safeLine(title, width)];

		const lines = [safeLine(title, width)];
		if (data.modifiedFiles.length) {
			lines.push("", safeLine(this.theme.fg("accent", this.theme.bold("Changed · observed through edit/write")), width));
			for (const change of data.modifiedFiles) {
				const marker = this.theme.fg("warning", change.kind === "write" ? "W" : "M");
				lines.push(joinColumns(`  ${marker} ${this.theme.fg("text", cleanDisplayText(change.path))}`, this.theme.fg("dim", changeStats(change)), width, 20));
			}
		}

		const verifications = data.records.filter((record) => record.category === "verify");
		if (verifications.length) {
			lines.push("", safeLine(this.theme.fg("accent", this.theme.bold("Verified")), width));
			for (const record of verifications) {
				const presentation = STATUS_PRESENTATION[record.status];
				const left = `  ${this.theme.fg(presentation.color, presentation.symbol)} ${this.theme.fg("text", record.target)}`;
				const right = this.theme.fg("dim", [record.outcome, formatDuration(record.durationMs)].filter(Boolean).join(" · "));
				lines.push(joinColumns(left, right, width, 20));
			}
		}

		const issues = data.records.filter((record) => record.status === "error" || record.status === "cancelled");
		if (issues.length) {
			lines.push("", safeLine(this.theme.fg("error", this.theme.bold("Issues")), width));
			for (const record of issues) {
				const presentation = STATUS_PRESENTATION[record.status];
				lines.push(joinColumns(`  ${this.theme.fg(presentation.color, presentation.symbol)} ${this.theme.fg("text", record.target)}`, this.theme.fg(presentation.color, record.outcome ?? record.status), width, 20));
				if (record.errorMessage) lines.push(safeLine(`    ${this.theme.fg("dim", record.errorMessage)}`, width));
			}
		}

		if (data.truncatedCount) {
			lines.push("", safeLine(this.theme.fg("warning", `${count(data.truncatedCount, "result")} truncated; full paths remain in expanded tool output.`), width));
		}

		const categories = [
			data.categoryCounts.inspect ? `${data.categoryCounts.inspect} inspected` : undefined,
			data.categoryCounts.change ? `${data.categoryCounts.change} changed` : undefined,
			data.categoryCounts.execute ? `${data.categoryCounts.execute} executed` : undefined,
			data.categoryCounts.verify ? `${data.categoryCounts.verify} verified` : undefined,
		].filter(Boolean).join(" · ");
		if (categories) lines.push("", safeLine(this.theme.fg("dim", `${categories} · ${keyHint("app.tools.expand", "collapse details")}`), width));
		return lines;
	}

	private renderLegacy(width: number): string[] {
		const files = this.data.modifiedFiles ?? [];
		const failures = this.data.failedActions ?? [];
		const actions = this.data.actionCount === undefined ? "previous run" : count(this.data.actionCount, "action");
		const errors = this.data.errorCount === undefined ? count(failures.length, "error category", "error categories") : count(this.data.errorCount, "error");
		const title = `${this.theme.fg(failures.length ? "error" : "muted", "Activity")} ${this.theme.fg("muted", `· ${actions} · ${count(files.length, "file")} · ${errors}`)}`;
		if (!this.expanded) return [safeLine(title, width)];
		return [safeLine(title, width), ...files.map((path) => safeLine(`  • ${path}`, width))];
	}

	invalidate(): void {}
}

type InspectorFilter = "all" | "changed" | "commands" | "issues";
type InspectableRecord = ActivityRecord | ActivityRecordSnapshot;

function isChanged(record: InspectableRecord): boolean {
	return record.category === "change";
}

function isIssue(record: InspectableRecord): boolean {
	return record.status === "error" || record.status === "cancelled";
}

export class ActivityInspectorComponent implements Component {
	private filter: InspectorFilter = "all";
	private selected = 0;
	private showDetail = false;
	private readonly filters: InspectorFilter[] = ["all", "changed", "commands", "issues"];

	constructor(
		private readonly records: InspectableRecord[],
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly onClose: () => void,
		private readonly onRender: () => void,
	) {}

	private filtered(): InspectableRecord[] {
		const newestFirst = [...this.records].reverse();
		switch (this.filter) {
			case "changed": return newestFirst.filter(isChanged);
			case "commands": return newestFirst.filter((record) => record.name === "bash");
			case "issues": return newestFirst.filter(isIssue);
			default: return newestFirst;
		}
	}

	private countFor(filter: InspectorFilter): number {
		switch (filter) {
			case "changed": return this.records.filter(isChanged).length;
			case "commands": return this.records.filter((record) => record.name === "bash").length;
			case "issues": return this.records.filter(isIssue).length;
			default: return this.records.length;
		}
	}

	private changeFilter(direction: number): void {
		const index = this.filters.indexOf(this.filter);
		this.filter = this.filters[(index + direction + this.filters.length) % this.filters.length]!;
		this.selected = 0;
		this.showDetail = false;
	}

	handleInput(data: string): void {
		const items = this.filtered();
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.onClose();
			return;
		}
		if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) this.changeFilter(-1);
		else if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) this.changeFilter(1);
		else if (this.keybindings.matches(data, "tui.select.up")) this.selected = Math.max(0, this.selected - 1);
		else if (this.keybindings.matches(data, "tui.select.down")) this.selected = Math.min(Math.max(0, items.length - 1), this.selected + 1);
		else if (this.keybindings.matches(data, "tui.select.confirm") && items.length) this.showDetail = !this.showDetail;
		else if (["1", "2", "3", "4"].includes(data)) {
			this.filter = this.filters[Number(data) - 1]!;
			this.selected = 0;
			this.showDetail = false;
		}
		this.onRender();
	}

	render(width: number): string[] {
		const lines: string[] = [safeLine(this.theme.fg("accent", this.theme.bold("Activity inspector")), width)];
		const tabs = this.filters.map((filter, index) => {
			const label = `${index + 1} ${filter[0]!.toUpperCase()}${filter.slice(1)} ${this.countFor(filter)}`;
			return filter === this.filter ? this.theme.fg("accent", this.theme.bold(`[${label}]`)) : this.theme.fg("dim", label);
		}).join("  ");
		lines.push(safeLine(tabs, width), "");

		const items = this.filtered();
		if (!items.length) {
			lines.push(safeLine(this.theme.fg("dim", "  No activity in this filter."), width));
		} else {
			const start = Math.max(0, Math.min(this.selected - 5, Math.max(0, items.length - 10)));
			for (let index = start; index < Math.min(items.length, start + 10); index++) {
				const record = items[index]!;
				const selected = index === this.selected;
				const presentation = STATUS_PRESENTATION[record.status];
				const cursor = selected ? this.theme.fg("accent", "›") : " ";
				const verb = (TOOL_VERBS[record.name] ?? record.name.toUpperCase()).padEnd(8);
				const left = `${cursor} ${this.theme.fg(presentation.color, presentation.symbol)} ${this.theme.fg("toolTitle", verb)}${this.theme.fg("toolOutput", record.target)}`;
				const right = this.theme.fg("dim", [record.outcome, formatDuration(recordDuration(record))].filter(Boolean).join(" · "));
				lines.push(joinColumns(left, right, width, 24));
			}
			if (items.length > 10) lines.push(safeLine(this.theme.fg("dim", `  ${this.selected + 1}/${items.length}`), width));

			const selectedRecord = items[this.selected];
			if (this.showDetail && selectedRecord) lines.push(...this.renderDetail(selectedRecord, width));
		}

		const keys = (id: "tui.select.up" | "tui.select.confirm" | "tui.select.cancel") => this.keybindings.getKeys(id).join("/");
		const help = `${keys("tui.select.up")} navigate · left/right filter · ${keys("tui.select.confirm")} inspect · ${keys("tui.select.cancel")} close`;
		lines.push("", safeLine(this.theme.fg("dim", help), width));
		return lines;
	}

	private renderDetail(record: InspectableRecord, width: number): string[] {
		const lines = ["", safeLine(this.theme.fg("borderMuted", "─".repeat(Math.max(1, width))), width)];
		lines.push(joinColumns(`  ${this.theme.fg("accent", "Target")} ${this.theme.fg("text", record.target)}`, this.theme.fg("dim", record.category), width, 20));
		lines.push(safeLine(`  ${this.theme.fg("accent", "Status")} ${record.status}${record.outcome ? ` · ${record.outcome}` : ""} · ${formatDuration(recordDuration(record))}`, width));
		if (record.change) lines.push(safeLine(`  ${this.theme.fg("accent", "Change")} ${cleanDisplayText(record.change.path)} · ${changeStats(record.change)}`, width));
		if (record.truncated) lines.push(safeLine(`  ${this.theme.fg("warning", "Output was truncated")}`, width));
		if (record.errorMessage) lines.push(...wrapTextWithAnsi(`  ${this.theme.fg("error", record.errorMessage)}`, Math.max(1, width)));
		if ("outputPreview" in record && record.outputPreview && !record.errorMessage) {
			lines.push(safeLine(`  ${this.theme.fg("accent", "Result")}`, width));
			for (const outputLine of record.outputPreview.split("\n").slice(0, PREVIEW_LINES)) {
				lines.push(safeLine(`    ${this.theme.fg("dim", cleanDisplayText(outputLine))}`, width));
			}
		}
		return lines;
	}

	invalidate(): void {}
}

function numberedCode(text: string, path: string, startLine: number, theme: Theme): string {
	const normalized = text.replace(/\t/g, "    ");
	const language = getLanguageFromPath(path);
	const lines = language ? highlightCode(normalized, language) : normalized.split("\n").map((line) => theme.fg("toolOutput", line));
	const lastLine = startLine + Math.max(0, lines.length - 1);
	const digits = String(lastLine).length;
	return lines.map((line, index) => `${theme.fg("dim", String(startLine + index).padStart(digits))} ${theme.fg("borderMuted", "│")} ${line}`).join("\n");
}

function truncationWarnings(result: unknown): string[] {
	if (!result || typeof result !== "object") return [];
	const details = (result as { details?: Record<string, unknown> }).details;
	if (!details) return [];
	const warnings: string[] = [];
	const truncation = details.truncation as { truncated?: boolean; outputLines?: number; totalLines?: number } | undefined;
	if (truncation?.truncated) {
		warnings.push(truncation.totalLines
			? `Truncated: showing ${truncation.outputLines ?? "some"} of ${truncation.totalLines} lines`
			: "Output truncated");
	}
	if (typeof details.fullOutputPath === "string") warnings.push(`Full output: ${details.fullOutputPath}`);
	if (details.matchLimitReached) warnings.push(`${details.matchLimitReached} match limit reached`);
	if (details.resultLimitReached) warnings.push(`${details.resultLimitReached} result limit reached`);
	if (details.entryLimitReached) warnings.push(`${details.entryLimitReached} entry limit reached`);
	if (details.linesTruncated) warnings.push("Some matching lines were truncated");
	return warnings;
}

export function renderExpandedToolResult(
	name: string,
	args: Record<string, unknown>,
	result: unknown,
	expanded: boolean,
	isError: boolean,
	showImages: boolean,
	theme: Theme,
	record?: ActivityRecord,
): Component {
	if (!expanded) return new Container();
	const text = resultText(result);
	const sections: string[] = [];
	const typedResult = result && typeof result === "object"
		? result as { content?: Array<{ type?: string; data?: string; mimeType?: string }>; details?: Record<string, unknown> }
		: undefined;
	const details = typedResult?.details;
	const images = typedResult?.content?.filter((item) => item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string") ?? [];

	if (isError) {
		sections.push(theme.fg("error", text || "Tool execution failed."));
	} else if (name === "edit" && typeof details?.diff === "string") {
		sections.push(renderDiff(details.diff, { filePath: typeof args.path === "string" ? args.path : undefined }));
	} else if (name === "write" && typeof args.content === "string") {
		sections.push(numberedCode(args.content, typeof args.path === "string" ? args.path : "", 1, theme));
	} else if (name === "read" && text) {
		sections.push(numberedCode(text, typeof args.path === "string" ? args.path : "", typeof args.offset === "number" ? args.offset : 1, theme));
	} else if (text) {
		sections.push(text.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n"));
	} else if (!images.length) {
		sections.push(theme.fg("dim", "No textual output."));
	}

	const warnings = truncationWarnings(result);
	if (warnings.length) sections.push(theme.fg("warning", warnings.map((warning) => `[${warning}]`).join("\n")));
	if (record?.durationMs !== undefined) sections.push(theme.fg("dim", `Took ${formatDuration(record.durationMs)}`));

	const component = new Container();
	if (sections.length) component.addChild(new Text(`\n${sections.join("\n\n")}`, 0, 0));
	if (images.length && showImages) {
		for (const image of images) {
			component.addChild(new Image(
				image.data!,
				image.mimeType!,
				{ fallbackColor: (value) => theme.fg("muted", value) },
				{ maxWidthCells: 80, maxHeightCells: 24 },
			));
		}
	} else if (images.length) {
		component.addChild(new Text(`\n${theme.fg("dim", `[${images.length} image result${images.length === 1 ? "" : "s"} hidden]`)}`, 0, 0));
	}
	return component;
}
