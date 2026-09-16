import { basename } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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

export default function minimalFooter(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
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
					const planStatus = statuses.get("plan-mode");
					const fastStatus = statuses.get("openai-codex-fast");
					const modelName = ctx.model?.name ?? ctx.model?.id ?? "no model";
					const model = fastStatus && visibleWidth(fastStatus) > 0 ? `${fastStatus} ${modelName}` : modelName;
					const thinking = pi.getThinkingLevel();
					const divider = theme.fg("borderAccent", " · ");
					const left = [
						planStatus && visibleWidth(planStatus) > 0 ? planStatus : undefined,
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
	});
}
