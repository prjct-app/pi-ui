# Changelog

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
