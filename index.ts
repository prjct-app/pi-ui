import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import registerActivity from "./src/activity/index.ts";
import registerHeader from "./src/header/index.ts";
import registerPalette from "./src/palette/index.ts";
import { readSettings, type UiSettings } from "./src/settings.ts";
import { applyFooter } from "./src/statusline.ts";
import registerTranscript, { setTranscript } from "./src/transcript.ts";
import registerUiCommand from "./src/ui-command.ts";

/**
 * pi-ui is the one interface layer: the header, transcript times, compact
 * tool activity, the footer, and the palette. Every part can be switched off with /ui, and
 * an off part leaves Pi's own in place.
 */
export default function pUi(pi: ExtensionAPI): void {
	const settings = readSettings();
	const header = registerHeader(pi);
	const palette = registerPalette(pi);

	const apply = async (ctx: ExtensionContext, next: UiSettings, newSession = false): Promise<void> => {
		setTranscript(next.transcript);
		applyFooter(pi, ctx, next.footer);
		palette.apply(ctx, next.palette, newSession);
		await header.apply(ctx, next.header);
	};

	registerTranscript(pi);
	// Activity replaces Pi's built-in tools, which can only happen while the extension loads.
	if (settings.activity) registerActivity(pi);
	registerUiCommand(pi, apply, settings.activity);

	pi.on("session_start", (_event, ctx) => apply(ctx, readSettings(), true));
}
