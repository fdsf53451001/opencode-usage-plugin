# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Type-check without emitting (the only lint/check step)
npm run check

# Publish (runs type-check first automatically)
npm publish
```

There is no test suite. `npm run check` (TypeScript `--noEmit`) is the only automated verification.

## Architecture

This is a **TUI-only OpenCode plugin** (`tui.tsx`) that renders AI provider usage panels inside the OpenCode editor. It uses SolidJS via `@opentui/solid` for reactive UI.

### Data flow

1. **Plugin entrypoint** — `tui.tsx` is the single plugin file. OpenCode loads it via the `./tui` export in `package.json`.
2. **Data fetching** — two strategies:
   - *Built-in (default)*: connectors in `scripts/connectors/` run in-process inside `tui.tsx` using dynamic `import()`.
   - *External command*: if the user passes `{ "command": "opencode-auth-usage" }` in options, the plugin shells out to that command instead.
3. **CLI binary** — `scripts/opencode-auth-usage.mjs` is the `bin` entry. It iterates over all connectors in `scripts/connectors/index.mjs` and prints a JSON snapshot to stdout.

### Connectors (`scripts/connectors/`)

Each connector is a `.mjs` file that exports `{ name, run({ auth }) }`. Currently:
- `copilot.mjs` — reads `~/.local/share/opencode/auth.json` (or `$OPENCODE_AUTH_PATH`)
- `kiro.mjs` — reads `~/.config/opencode/kiro.db` (or `$OPENCODE_KIRO_DB_PATH`) using Kiro's current access token without refreshing it
- `shared.mjs` — utilities: `readJson`, `curlJson`, `quotaItem`, `buildSummary`, `defaultPaths`

To add a new provider, create a new `scripts/connectors/<name>.mjs` and register it in `scripts/connectors/index.mjs`.

### Core types in `tui.tsx`

- `UsageItem` — one row of usage data, `kind: "quota" | "cost"`
- `Snapshot` — result of a fetch: `{ source, updatedAt, items, summary, totalCost? }`
- `PluginConfig` — resolved plugin options (camelCase internally, snake_case in `tui.json`)

### Payload normalization

`normalizePayload()` in `tui.tsx` handles two external JSON formats:
- **Native** (`{ items: [...] }`) — used by this plugin's own connectors and any `opencode-auth-usage`-compatible tool
- **Opencodebar** (`{ providerID: { type, ... } }`) — legacy/alternative format with `"quota-based"` or `"pay-as-you-go"` types

### UI structure

- Compact `UsagePanel` component — shown on home screen and session sidebar (controlled by `show_home` / `show_sidebar` options)
- Full-screen route registered as `opencode.usage-bar.screen` — opened via the `/usage` command
- `/usage-refresh` command triggers a manual fetch

Color coding in `itemTone()`: used ≥ 85% → error (red), ≥ 60% → warning (yellow), else success (green).
