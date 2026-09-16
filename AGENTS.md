# Repository instructions

- Integration branch: `main`. Create feature branches from `main` and target `main` in pull requests.
- Use English for code, documentation, tests, issues, and pull requests.
- Use strict TypeScript and only APIs documented by Pi 0.85.1.
- Keep this package discoverable as exactly one Pi extension through `index.ts`.
- Do not import host internals, monkey-patch prototypes, or access real credentials, sessions, or user configuration in tests.
- Keep runtime dependencies in `dependencies`; list Pi-provided packages in `peerDependencies` with a `*` range.
- Run `npm run check`, `npm test`, and `npm pack --dry-run` before review.
- Never push, open or merge a pull request, publish, or deploy without explicit authorization.
