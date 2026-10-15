# pi-ui

[![pi-ui — for PI Agent](https://raw.githubusercontent.com/prjct-app/pi-ui/main/docs/cover.png)](https://pi.dev)

A single Pi extension for the footer and transcript of PI Agent. It does not set a startup header. Tool rows and the activity inspector come from `@prjct.app/pi-activity`.

## Features

- A focused footer with project, session, Git branch, model, thinking level, and context usage.
- The bundled `prjct-theme` dark palette for a consistent activity, footer, Markdown, diff, and syntax experience.
- Pi Plan status at the start of the footer and the Codex Fast icon beside the model when those extensions are active.

## Install

```bash
pi install npm:@prjct.app/pi-ui
```

For a project-only installation:

```bash
pi install -l npm:@prjct.app/pi-ui
```

Remove `@prjct.app/pi-statusline` when migrating. Install `@prjct.app/pi-activity` next to pi-ui for compact tool rows and the `/activity` inspector.

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


## Compatibility

Tested with Pi `0.85.1` and Node.js `22.19+`. The extension uses documented Pi APIs and is active only where each interface is supported. The footer requires TUI mode.

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

MIT.
