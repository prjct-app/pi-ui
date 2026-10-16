# pi-ui

[![pi-ui — for PI Agent](https://raw.githubusercontent.com/prjct-app/pi-ui/main/docs/cover.png)](https://pi.dev)

The one interface layer for PI Agent. pi-ui owns every change it makes to Pi's screen, and every change can be switched off with `/ui`. A part that is off leaves Pi's own in place.

| Part | What it does | Off means | Takes effect |
| --- | --- | --- | --- |
| Header | Pi's own startup header by default, or the prjct logo or your own pixel-art logo chosen with `/header`. | No startup header. | At once |
| Transcript | Puts `u. 16:18` over your messages and `p. 16:22` over Pi's prose. | Pi's plain transcript. | Messages drawn after the change |
| Activity | Compact, expandable tool rows, a live widget for running tools, a summary after each run, `/activity` and `/activity-settings`. | Pi's built-in tool rows. | When Pi starts again |
| Footer | Project, session, Git branch, model, thinking level, and context usage. | Pi's default footer. | At once |

Lines drawn by other extensions through `@prjct.app/pi-tui-kit` (modes, team, usage) are theirs, not pi-ui's, and `/ui` does not switch them.

## Install

```bash
pi install npm:@prjct.app/pi-ui
```

For a project-only installation:

```bash
pi install -l npm:@prjct.app/pi-ui
```

pi-ui 2 includes what used to be `@prjct.app/pi-activity` and `@prjct.app/pi-header`. Remove both (and `pi-statusline`) when upgrading; two packages replacing the same tools or registering `/header` conflict. A logo saved by pi-header is copied over on first start:

```bash
pi remove npm:@prjct.app/pi-activity
pi remove npm:@prjct.app/pi-header
```

Quit and reopen Pi after installing or upgrading. `/new` keeps the old modules.

## Switch parts on or off

Run `/ui`. A docked checklist lists the four parts; Space toggles one, Enter saves. The choice is stored in `~/.prjct/pi-ui/settings.json` (or `$PRJCT_HOME/pi-ui/settings.json`) and applies to every project:

```json
{
  "header": true,
  "transcript": true,
  "activity": true,
  "footer": true
}
```

A missing file, or a missing key, means on. Activity replaces Pi's seven built-in tools (`read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`) and codemode's renderer, which Pi allows only while an extension loads, so turning it on or off asks you to quit and reopen Pi.

## Header

The header starts as Pi's own. `/header` picks another:

- `/header pi` (or `/header reset`) — Pi's own header.
- `/header prjct` — the prjct logo with `prjct / pi agent · v…`.
- `/header logo` then paste an image or SVG, or `/header logo <path>` — pixel art from your reference, previewed before it is saved. `/header cancel` stops the capture.

The choice is stored in `~/.prjct/pi-ui/header.json`. While the header is off in `/ui`, a new choice is saved but stays hidden.

## Activity

Tool calls become semantic rows:

```text
◆ RUN     npm test                              1.8s
✓ READ    src/auth.ts                    184 lines
✓ SEARCH  "renderResult"                  8 matches
✓ EDIT    src/auth.ts                    +18 −6
✕ RUN     npm run lint                  exit 1
```

While tools run, a widget above the editor shows parallel work. Use Pi's tool-output expansion shortcut (`Ctrl+O` by default) for detail: reads and writes with line numbers, edits with diffs, truncation evidence, and full-output paths.

- `/activity` opens the inspector with All, Changed, Commands, and Issues filters; Enter shows a record's metadata and result preview. It keeps the latest 200 actions of the session.
- `/activity-settings` picks the row density, or `/activity-settings forensic` sets it directly: `minimal` (action and target), `balanced` (outcomes and durations, default), `forensic` (adds category and truncation evidence). The density is saved in the session.

Activity keeps the native execution of every tool it renders; it changes only how calls are shown. Modified files are reported as observed through `edit` and `write`, not as a repository diff.

## Theme

The bundled `prjct-theme` dark palette is offered, never applied for you. Select it from `/settings`, or set `"theme": "prjct-theme"` in `settings.json`.

## Compatibility

Tested with Pi `0.85.1` and Node.js `22.19+`. The header, transcript, activity widget, and footer require TUI mode; tools render compactly wherever Pi renders them.

## Development

```bash
npm install
npm run check
npm test
npm pack --dry-run
```

To try a checkout without the npm copy, remove `@prjct.app/pi-ui` and `@prjct.app/pi-activity` from your packages and run `pi -e ./index.ts`.

See [docs/package.md](docs/package.md) for package structure and API details.

## License

MIT.
