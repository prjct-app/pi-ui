# Package structure and compatibility

## Identity

- npm name: `@prjct.app/p-ui`.
- Initial version: `0.1.0`.
- Source repository: [prjct-app/p-ui](https://github.com/prjct-app/p-ui).
- Tested host: Pi `0.85.1`; Node.js `22.19+`.

p-ui consolidates the published behavior of `@prjct.app/pi-activity`, `@prjct.app/pi-header`, and `@prjct.app/pi-statusline`. Existing activity command names, persisted entry types, status keys, and tool overrides remain unchanged for session compatibility.

## One-extension manifest

The package declares exactly one Pi extension:

```json
{
  "name": "@prjct.app/p-ui",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

`index.ts` is the sole Pi entry point. It composes internal activity, header, and status-line registrars from `src/`; those modules are implementation details, not separately discovered extensions.

## Dependencies

Pi-provided libraries are peer dependencies with `*` ranges and are not bundled. Exact Pi 0.85.1 development dependencies establish the tested baseline; the peer wildcard does not claim compatibility with every Pi release.

## Public interfaces

The package uses documented tool overrides and render contexts, lifecycle and tool-execution events, custom session entries and renderers, commands, working messages, widgets, status text, `ctx.ui.custom()`, `SettingsList`, `ctx.ui.setHeader()`, `ctx.ui.setFooter()`, footer branch subscriptions and extension statuses, session names, context usage, image rendering, and TUI width utilities.

Terminal-only behavior is guarded with `ctx.mode === "tui"`. Activity deliberately leaves Pi's default working indicator unchanged. The custom footer displays only Pi Plan and Codex Fast statuses.

## Published contents

The `files` allowlist includes the single TypeScript entry point, internal runtime modules, logo assets, user documentation, and required licenses. Tests, repository settings, dependency folders, and Git history are excluded.

Run `npm run check:package` to inspect the prospective tarball before release.

## Official references

- [Pi packages 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md)
- [Pi extensions 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)
- [Pi TUI 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md)
