# pi-ui

[![pi-ui — for PI Agent](https://raw.githubusercontent.com/prjct-app/pi-ui/main/docs/cover.png)](https://pi.dev)

The one interface layer for PI Agent. pi-ui owns every change it makes to Pi's screen, and every change can be switched off with `/ui`. A part that is off leaves Pi's own in place.

| Part | What it does | Off means | Takes effect |
| --- | --- | --- | --- |
| Header | The logo chosen with `/header`: Pi's own header by default, or the prjct logo, or your own pixel-art logo. | Pi's own startup header, whatever `/header` chose. | At once |
| Transcript | Puts `u. 16:18` over your messages and `p. 16:22` over Pi's prose. | Pi's plain transcript. | Messages drawn after the change |
| Activity | Compact, expandable tool rows, a live widget for running tools, a summary after each run, `/activity` and `/activity-settings`. | Pi's built-in tool rows. | When Pi starts again |
| Footer | Project, session, Git branch, model, thinking level, and context usage. | Pi's default footer. | At once |
| Palette | 53 color themes with `/palette`, the active one shared across open Pi windows, and weekly backups. | `/palette` does nothing; no window sync or backups. The current theme stays. | At once |

Lines drawn by other extensions through `@prjct.app/pi-tui-kit` (modes, team, usage) are theirs, not pi-ui's, and `/ui` does not switch them.

## Install

```bash
pi install npm:@prjct.app/pi-ui
```

For a project-only installation:

```bash
pi install -l npm:@prjct.app/pi-ui
```

pi-ui 2 includes what used to be `@prjct.app/pi-activity`, `@prjct.app/pi-header`, and `@prjct.app/pi-palette`. Remove them (and `pi-statusline`) when upgrading; two packages replacing the same tools or registering `/header` or `/palette` conflict. Palette data already in `~/.prjct/pi-palette` is used as is. A logo saved by pi-header is copied over on first start:

```bash
pi remove npm:@prjct.app/pi-activity
pi remove npm:@prjct.app/pi-header
pi remove npm:@prjct.app/pi-palette
```

Quit and reopen Pi after installing or upgrading. `/new` keeps the old modules.

## Switch parts on or off

Run `/ui`. A docked checklist lists the five parts; Space toggles one, Enter saves. The choice is stored in `~/.prjct/pi-ui/settings.json` (or `$PRJCT_HOME/pi-ui/settings.json`) and applies to every project:

```json
{
  "header": true,
  "transcript": true,
  "activity": true,
  "footer": true,
  "palette": true
}
```

A missing file, or a missing key, means on. Activity replaces Pi's seven built-in tools (`read`, `bash`, `edit`, `write`, `find`, `grep`, `ls`) and codemode's renderer, which Pi allows only while an extension loads, so turning it on or off asks you to quit and reopen Pi.

## Header

The header starts as Pi's own. `/header` picks another:

- `/header pi` (or `/header reset`) — Pi's own header.
- `/header prjct` — the prjct logo with `prjct / pi agent · v…`.
- `/header logo` then paste an image or SVG, or `/header logo <path>` — pixel art from your reference, previewed before it is saved. `/header cancel` stops the capture.

The choice is stored in `~/.prjct/pi-ui/header.json`. While the header is off in `/ui`, Pi's own header shows; a new choice is saved and appears when the header is turned back on.

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

## Palette

- `/palette` opens the picker: Favorites, Your palettes, Editor classics, From photos, Originals, Backups, and Account on the left; the highlighted category's list on the right with a live preview. `f` favorites, `a` applies, `b` backs up now, `r` (twice) restores, `s` syncs, `l` logs in or out, `i` imports, `e` exports.
- `/palette <id>` applies a palette, for example `/palette nord`; `/palette next`, `/palette prev`, and `/palette random` change it directly.
- `/palette import [file]` and `/palette export [file]` move your library as a file (default `~/Downloads/library.json` and `~/Downloads/pi-palette-export.json`), fully offline.
- `/palette login`, `/palette sync`, and `/palette logout` connect this Pi to your library on [pi-themes](https://palette.prjct.app) only when you ask. The token can read and write only your palette library; without it the palette never reaches the network. `PI_THEMES_URL` points at another pi-themes deployment.
- `/palette backup` backs up now; `/palette backups` opens the picker on Backups. Every start checks whether a week has passed and, if so, backs up in the background: the last 10 versions on this computer and, while connected, on pi-themes. An unchanged library is not saved again.

Palettes are data: the bundled set ships in `src/palette/palettes.json` and your own library, favorites, backups, and token live in `~/.prjct/pi-palette` (or `$PRJCT_HOME/pi-palette`). Theme files are generated into Pi's themes folder each time Pi loads, because Pi applies the theme in your settings before extensions run. Only files the palette wrote are ever rewritten or removed; a theme of your own with the same name wins.

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
