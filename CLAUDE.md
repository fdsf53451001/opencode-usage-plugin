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
   - *Built-in (default)*: `tui.tsx` has its own inline connector implementations (`builtinConnectors` map). These are **duplicates** of the `scripts/connectors/*.mjs` logic, not imports of them — the `.mjs` files serve the CLI path only.
   - *External command*: if the user passes `{ "command": "opencode-auth-usage" }` in options, the plugin shells out to that command instead.
3. **CLI binary** — `scripts/opencode-auth-usage.mjs` is the `bin` entry. It iterates over all connectors in `scripts/connectors/index.mjs` and prints a JSON snapshot to stdout.

### Connectors (`scripts/connectors/`)

Each connector is a `.mjs` file that exports `{ name, run({ auth }) }`. Currently:
- `copilot.mjs` — reads `~/.local/share/opencode/auth.json` (or `$OPENCODE_AUTH_PATH`)
- `kiro.mjs` — reads `~/.config/opencode/kiro.db` (or `$OPENCODE_KIRO_DB_PATH`) using Kiro's current access token without refreshing it
- `codex.mjs` — reads the OpenAI/Codex OAuth token from `auth.json`, extracts `chatgpt_account_id` from the JWT, queries the ChatGPT usage endpoint
- `nvidia.mjs` — local estimate only (NVIDIA has no usage API): counts today's `step-start` parts (local-midnight reset; NVIDIA publishes neither a daily quota nor a reset time) for `providerID: "nvidia"` in `~/.local/share/opencode/opencode.db` (or `$OPENCODE_DB_PATH`) against a daily limit (default 1000, `$OPENCODE_NVIDIA_DAILY_LIMIT` / `nvidia_daily_limit` option)
- `grok.mjs` — reads the xAI OAuth token from `auth.json` (`xai` / `grok`), queries Grok CLI billing (`cli-chat-proxy.grok.com/v1/billing?format=credits`) and subscription (`/v1/user?include=subscription`)
- `shared.mjs` — utilities: `readJson`, `curlJson`, `quotaItem`, `buildSummary`, `defaultPaths`

To add a new provider, implement it **twice**:
1. Create `scripts/connectors/<name>.mjs` and register it in `scripts/connectors/index.mjs` (CLI path)
2. Add a matching `<name>Connector()` function in `tui.tsx` and register it in the `builtinConnectors` map (built-in path)

Connectors that need SQLite in `tui.tsx` should use the `loadSqliteDriver()` helper (`bun:sqlite` with `node:sqlite` fallback); the `.mjs` side uses `node:sqlite`'s `DatabaseSync` directly, always with `{ readOnly: true }`.

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
