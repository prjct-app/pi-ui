# Package structure and compatibility

## Identity

- npm name: `@prjct.app/pi-ui`.
- Initial version: `0.1.0`.
- Source repository: [prjct-app/pi-ui](https://github.com/prjct-app/pi-ui).
- Tested host: Pi `0.85.1`; Node.js `22.19+`.

pi-ui is the single interface package: the startup header (Pi's own by default, or a pixel-art logo; formerly `@prjct.app/pi-header`), transcript times, compact tool activity (formerly `@prjct.app/pi-activity`), and the footer. Each part is switched with `/ui` and stored in `$PRJCT_HOME/pi-ui/settings.json`, defaulting to `~/.prjct/pi-ui/settings.json`.

## One-extension manifest

The package declares exactly one Pi extension:

```json
{
  "name": "@prjct.app/pi-ui",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./index.ts"],
    "themes": ["./themes/prjct-theme.json"]
  }
}
```

`index.ts` is the sole Pi extension entry point. It reads the `/ui` switches, then composes the internal header, transcript, activity, and footer registrars from `src/`; those modules are implementation details, not separately discovered extensions. The same package also contributes the declarative `prjct-theme` resource without introducing another extension.

## Dependencies

`sharp` is a runtime dependency for header logos; it is imported only when a pixel-art logo is decoded. Pi-provided libraries are peer dependencies with `*` ranges and are not bundled. Exact Pi 0.85.1 development dependencies establish the tested baseline; the peer wildcard does not claim compatibility with every Pi release.

## Public interfaces

The package uses documented tool overrides and render contexts, lifecycle and tool-execution events, custom session entries and renderers, commands, working messages, widgets, status text, `ctx.ui.custom()`, `SettingsList`, `ctx.ui.setHeader()`, `ctx.ui.setFooter()`, footer branch subscriptions and extension statuses, session names, context usage, image rendering, and TUI width utilities.

Terminal-only behavior is guarded with `ctx.mode === "tui"`. Activity overrides the seven built-in tools only when it is on at load, because Pi registers tools while extensions load; the header, footer, and transcript switches apply at once through `ctx.ui.setHeader()`, `ctx.ui.setFooter()`, and a render flag. The custom footer displays only Pi Plan and Codex Fast statuses.

## Published contents

The `files` allowlist includes the single TypeScript entry point, internal runtime modules, the `prjct-theme` theme resource, and user documentation. Tests, repository settings, dependency folders, and Git history are excluded.

Run `npm run check:package` to inspect the prospective tarball before release.

## Official references

- [Pi packages 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md)
- [Pi extensions 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)
- [Pi TUI 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md)
