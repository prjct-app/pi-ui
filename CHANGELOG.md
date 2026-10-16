## [2.0.0](https://github.com/prjct-app/pi-ui/compare/v1.0.0...v2.0.0) (2026-10-16)

### ⚠ BREAKING CHANGES

* pi-ui registers the read, bash, edit, write, find, grep
and ls tools plus /activity, /activity-settings and /header. Remove
@prjct.app/pi-activity and @prjct.app/pi-header before upgrading.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Features

* absorb pi-palette with its own /ui switch ([d26acca](https://github.com/prjct-app/pi-ui/commit/d26acca19ad76d2d966a19907514942275698ec2))
* one interface package with /ui switches for every part ([9e51fcd](https://github.com/prjct-app/pi-ui/commit/9e51fcd1cae98c6289b7534f01f80514345771bb))

## [1.0.0](https://github.com/prjct-app/pi-ui/compare/v0.1.5...v1.0.0) (2026-10-15)

### ⚠ BREAKING CHANGES

* pi-ui no longer sets a startup header or registers /header.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Features

* decouple pi-ui from pi-header ([b8342ef](https://github.com/prjct-app/pi-ui/commit/b8342ef987448b3a4b3faf6df24359fb2ff26c92))

# Changelog

## Unreleased

- Breaking: pi-ui no longer depends on `@prjct.app/pi-header` or sets a startup header. The `/header` command, the Pi logo assets and their license notice are removed. Install `@prjct.app/pi-header` on its own if you want a header.

## 0.1.5 (2026-10-12)

- Code: no `let` bindings; mutable state lives in one named object. Behaviour is unchanged.
- Tests run with temporary Pi and prjct folders. Two header tests that already failed before this release still fail.

## 0.1.4

- Remove the tool-row overrides, `/activity`, and `/activity-settings` from pi-ui. Install `@prjct.app/pi-activity` (0.2.3) for compact tool rows; loading both would override the same built-in tools.
- Remove the activity-only modules (`src/activity*.ts`, `src/components.ts`, `src/format.ts`, `src/types.ts`).

## 0.1.0

- Combine Pi Activity, Pi Header, and Pi Statusline into one installable Pi extension.
- Preserve compact tool activity, activity inspection, and density settings.
- Preserve the branded Pi startup header and focused custom footer.
- Bundle the `prjct-theme` palette so the complete UI ships from one package.
