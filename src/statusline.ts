import { basename } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const BAR_WIDTH = 8;
const USED_SEGMENT = "⠿";
const AVAILABLE_SEGMENT = "⠄";

function contextUsedBar(percentUsed: number | null | undefined): string {
	if (percentUsed === null || percentUsed === undefined) {
		return AVAILABLE_SEGMENT.repeat(BAR_WIDTH);
	}

	const used = Math.round((Math.min(100, Math.max(0, percentUsed)) / 100) * BAR_WIDTH);
	return USED_SEGMENT.repeat(used) + AVAILABLE_SEGMENT.repeat(BAR_WIDTH - used);
}

/** Put the pi-ui footer in place of Pi's, or give Pi's back when it is switched off. */
export function applyFooter(pi: ExtensionAPI, ctx: ExtensionContext, on: boolean): void {
	if (ctx.mode !== "tui") return;
	if (!on) {
		ctx.ui.setFooter(undefined);
		return;
	}
	// Modes (plan, fast, agents) are drawn by the shared kit, right above the
	// editor; the footer below the editor carries only where and what.
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribeBranchChange = footerData.onBranchChange(() => tui.requestRender());

		return {
			dispose: unsubscribeBranchChange,
			invalidate() {},
			render(width: number): string[] {
				const project = basename(ctx.cwd) || ctx.cwd;
				const sessionName = pi.getSessionName();
				const branch = footerData.getGitBranch();
				const statuses = footerData.getExtensionStatuses();
				const fastStatus = statuses.has("mode:fast") ? undefined : statuses.get("pi-fast-mode");
				const modelName = ctx.model?.name ?? ctx.model?.id ?? "no model";
				const model = fastStatus && visibleWidth(fastStatus) > 0 ? `${fastStatus} ${modelName}` : modelName;
				const thinking = pi.getThinkingLevel();
				const divider = theme.fg("borderAccent", " · ");
				const left = [
					project,
					sessionName,
					branch ? ` ${branch}` : undefined,
					model,
					thinking,
				]
					.filter((item): item is string => item !== undefined)
					.join(divider);
				const bar = contextUsedBar(ctx.getContextUsage()?.percent);
				const availableLeft = Math.max(0, width - visibleWidth(bar) - 1);
				const visibleLeft = truncateToWidth(left, availableLeft, "");
				const gap = " ".repeat(Math.max(1, width - visibleWidth(visibleLeft) - visibleWidth(bar)));

				return [truncateToWidth(`${visibleLeft}${gap}${bar}`, width, "")];
			},
		};
	});
}

export default function minimalFooter(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => applyFooter(pi, ctx, true));
}
