import { ago } from "@prjct.app/pi-tui-kit";
import { WEEK_MS, type BackupReason, type BackupState } from "./backup.ts";

/** Legacy composer fact, cleared on startup when reloading an older build. */
export const FACT = "palette-backup";

/** "in 5d", "in 3h", "now": when the weekly check runs next. */
export function nextCheck(state: BackupState, now = Date.now()): string {
	if (state.checkedAt === undefined) return "now";
	const left = state.checkedAt + WEEK_MS - now;
	if (left <= 0) return "now";
	const hours = Math.ceil(left / 3_600_000);
	return hours < 48 ? `in ${hours}h` : `in ${Math.ceil(hours / 24)}d`;
}

/** The picker's backup summary: when the last backup ran and what each side keeps. */
export function factText(state: BackupState, localCount: number, connected: boolean, running: boolean, now = Date.now()): string {
	if (running) return "palette backup…";
	if (state.checkedAt === undefined) return "palette backup pending";
	const parts = [`palette backup ${ago(state.checkedAt, now)}`, `${localCount} local`];
	if (connected) parts.push(state.cloudError ? "cloud ✕" : state.cloudCount !== undefined ? `${state.cloudCount} cloud` : "cloud —");
	return parts.join(" · ");
}

export function when(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso || "—";
	return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const WHY: Record<BackupReason, string> = { weekly: "weekly check", manual: "backed up by hand", connect: "first backup after connecting", restore: "saved before a restore" };
