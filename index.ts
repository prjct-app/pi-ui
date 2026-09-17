import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import registerActivity from "./src/activity.ts";
import registerHeader from "./src/header.ts";
import registerStatusline from "./src/statusline.ts";

/** Install the complete p-ui experience as one Pi extension. */
export default function pUi(pi: ExtensionAPI): void {
	registerActivity(pi);
	registerHeader(pi);
	registerStatusline(pi);
}
