# pi-ui

[![pi-ui — for PI Agent](https://raw.githubusercontent.com/prjct-app/pi-ui/main/docs/cover.png)](https://pi.dev)

A single Pi extension that combines the interfaces previously distributed as Pi Activity, Pi Header, and Pi Statusline.

## Features

- Compact, expandable rows for Pi's built-in file, search, and shell tools.
- Live activity state above the editor, including parallel work and prompts waiting for input.
- Persisted activity summaries, an `/activity` inspector, and configurable display density.
- A minimal startup header with the Pi logo and installed Pi version.
- A focused footer with project, session, Git branch, model, thinking level, and context usage.
- The bundled `prjct-theme` dark palette for a consistent header, activity, footer, Markdown, diff, and syntax experience.
- Pi Plan status at the start of the footer and the Codex Fast icon beside the model when those extensions are active.

## Install

```bash
pi install npm:@prjct.app/pi-ui
```

For a project-only installation:

```bash
pi install -l npm:@prjct.app/pi-ui
```

Remove `@prjct.app/pi-activity`, `@prjct.app/pi-header`, and `@prjct.app/pi-statusline` when migrating. Loading them alongside pi-ui would register duplicate UI behavior and tool overrides.

Select `prjct-theme` from `/settings`, or set it directly in `settings.json`:

```json
{
  "theme": "prjct-theme"
}
```

To test a local checkout:

```bash
pi -e ./index.ts
```

## Commands

- `/activity` opens the recent activity inspector.
- `/activity-settings` opens the density selector.
- `/activity-settings minimal|balanced|forensic` changes density directly.

Density preferences and activity summaries are stored as TUI-only custom session entries and do not enter model context.

## Compatibility

Tested with Pi `0.85.1` and Node.js `22.19+`. The extension uses documented Pi APIs and is active only where each interface is supported. The header and footer require TUI mode; activity tool overrides continue to execute in non-TUI modes without invoking terminal-only methods.

The custom footer replaces Pi's default footer. It intentionally reads only Pi Plan and Codex Fast extension statuses rather than aggregating every extension status.

## Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

See [docs/package.md](docs/package.md) for package structure and API details.

## License

MIT. The Pi logo provenance is documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
