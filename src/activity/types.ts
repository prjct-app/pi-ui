export type ActivityDensity = "minimal" | "balanced" | "forensic";
export type ActivityStatus = "running" | "success" | "error" | "cancelled";
export type ActivityCategory = "inspect" | "change" | "verify" | "execute" | "other";

export interface FileChange {
	path: string;
	kind: "edit" | "write";
	actions: number;
	additions?: number;
	deletions?: number;
	lines?: number;
	bytes?: number;
}

export interface ActivityRecordSnapshot {
	id: string;
	name: string;
	target: string;
	category: ActivityCategory;
	status: Exclude<ActivityStatus, "running">;
	startedAt: number;
	durationMs: number;
	outcome?: string;
	truncated?: boolean;
	change?: FileChange;
	errorMessage?: string;
}

export interface ActivityRecord {
	id: string;
	name: string;
	args: Record<string, unknown>;
	target: string;
	category: ActivityCategory;
	status: ActivityStatus;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	outcome?: string;
	truncated?: boolean;
	change?: FileChange;
	errorMessage?: string;
	outputPreview?: string;
}

export interface ActivitySummaryData {
	version: 2;
	startedAt: number;
	durationMs: number;
	actionCount: number;
	errorCount: number;
	cancelledCount: number;
	truncatedCount: number;
	modifiedFiles: FileChange[];
	completedActions: string[];
	failedActions: string[];
	categoryCounts: Partial<Record<ActivityCategory, number>>;
	records: ActivityRecordSnapshot[];
}

export interface LegacyActivitySummaryData {
	modifiedFiles?: string[];
	failedActions?: string[];
	completedActions?: string[];
	actionCount?: number;
	errorCount?: number;
}
