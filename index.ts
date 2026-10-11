import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import registerHeader from "./src/header.ts";
import registerTranscript from "./src/transcript.ts";
import registerStatusline from "./src/statusline.ts";

/** Install the pi-ui header, transcript and status line as one Pi extension. Tool rows come from @prjct.app/pi-activity. */
export default function pUi(pi: ExtensionAPI): void {
	registerHeader(pi);
	registerTranscript(pi);
	registerStatusline(pi);
}
