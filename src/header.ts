import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { Container, Image, Text } from "@earendil-works/pi-tui";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const officialLogo = readFileSync(join(extensionDir, "..", "assets", "pi-logo.png")).toString("base64");

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setHeader((_tui, theme) => {
      const header = new Container();
      header.addChild(new Image(officialLogo, "image/png", { fallbackColor: (text) => theme.fg("muted", text) }, {
        maxWidthCells: 16,
        maxHeightCells: 8,
      }));
      header.addChild(new Text(theme.fg("muted", `Pi coding agent v${VERSION}`), 0, 0));
      return header;
    });
  });
}
