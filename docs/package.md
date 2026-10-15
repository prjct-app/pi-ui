# Package structure and compatibility

## Identity

- npm name: `@prjct.app/pi-ui`.
- Initial version: `0.1.0`.
- Source repository: [prjct-app/pi-ui](https://github.com/prjct-app/pi-ui).
- Tested host: Pi `0.85.1`; Node.js `22.19+`.

pi-ui keeps the footer and transcript of the former pi-ui bundle. Tool rows and the activity inspector moved to `@prjct.app/pi-activity`, which is installed alongside it. The startup header is the separate `@prjct.app/pi-header` package; pi-ui does not depend on it.

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

`index.ts` is the sole Pi extension entry point. It composes internal transcript and status-line registrars from `src/`; those modules are implementation details, not separately discovered extensions. The same package also contributes the declarative `prjct-theme` resource without introducing another extension.

## Dependencies

Pi-provided libraries are peer dependencies with `*` ranges and are not bundled. Exact Pi 0.85.1 development dependencies establish the tested baseline; the peer wildcard does not claim compatibility with every Pi release.

## Public interfaces

The package uses documented tool overrides and render contexts, lifecycle and tool-execution events, custom session entries and renderers, commands, working messages, widgets, status text, `ctx.ui.custom()`, `SettingsList`, `ctx.ui.setFooter()`, footer branch subscriptions and extension statuses, session names, context usage, image rendering, and TUI width utilities.

Terminal-only behavior is guarded with `ctx.mode === "tui"`. The transcript does not override tool rows; pi-activity owns them. The custom footer displays only Pi Plan and Codex Fast statuses.

## Published contents

The `files` allowlist includes the single TypeScript entry point, internal runtime modules, the `prjct-theme` theme resource, and user documentation. Tests, repository settings, dependency folders, and Git history are excluded.

Run `npm run check:package` to inspect the prospective tarball before release.

## Official references

- [Pi packages 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/packages.md)
- [Pi extensions 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)
- [Pi TUI 0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/tui.md)
