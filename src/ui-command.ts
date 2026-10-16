import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openChecklist } from "@prjct.app/pi-tui-kit";

import { PARTS, readSettings, writeSettings, type Part, type UiSettings } from "./settings.ts";

const LABELS: Record<Part, { label: string; meta: string }> = {
	header: { label: "Header — the logo chosen in /header (off: Pi's own)", meta: "live" },
	transcript: { label: "Transcript — u./p. times over messages", meta: "new messages" },
	activity: { label: "Activity — compact tool rows and /activity", meta: "restart Pi" },
	footer: { label: "Footer — project, branch, model, context", meta: "live" },
	palette: { label: "Palette — /palette themes, sync between windows, backups", meta: "live" },
};

export type Apply = (ctx: ExtensionContext, settings: UiSettings) => Promise<void>;

/**
 * /ui: one docked checklist with a switch for every part of the interface
 * pi-ui changes. Header, footer, transcript and palette follow at once; activity
 * replaces Pi's tools when Pi starts, so it waits for the next start.
 */
export default function registerUiCommand(pi: ExtensionAPI, apply: Apply, loadedActivity: boolean): void {
	pi.registerCommand("ui", {
		description: "Turn the header, transcript times, activity rows, footer, and palette on or off.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				if (ctx.hasUI) ctx.ui.notify("/ui requires interactive TUI mode.", "error");
				return;
			}
			const current = readSettings();
			const result = await openChecklist(ctx, {
				title: "Interface",
				message: "Checked parts are on. Unchecked parts fall back to Pi's own.",
				items: PARTS.map((id) => ({ id, ...LABELS[id] })),
				initial: PARTS.filter((part) => current[part]),
				min: 0,
				all: false,
				other: false,
			});
			if (!result) return;
			const next = Object.fromEntries(PARTS.map((part) => [part, result.ids.includes(part)])) as UiSettings;
			writeSettings(next);
			await apply(ctx, next);
			if (next.activity !== loadedActivity) {
				ctx.ui.notify(`Activity turns ${next.activity ? "on" : "off"} when Pi starts again. Quit and reopen Pi; /new is not enough.`, "warning");
			}
		},
	});
}
