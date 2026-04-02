# opencode-usage-plugin

OpenCode TUI plugin that shows your AI provider usage quota directly inside OpenCode.

Auto-detects available providers. Auto-refreshes every 60 seconds.

## Supported providers

| Provider | Auth source | What it shows |
|----------|-------------|---------------|
| GitHub Copilot | `~/.local/share/opencode/auth.json` | Premium interactions remaining %, plan type, reset date |
| Kiro | `~/.config/opencode/kiro.db` | Usage / limit per account, auto token refresh |

More providers coming soon.

## What you get

- Collapsible usage panel on the home screen
- Collapsible usage panel in the session sidebar
- `/usage` command for a full-screen detailed view
- `/usage-refresh` command to manually refresh
- Color-coded progress bars (green → yellow → red as quota decreases)

## Requirements

- OpenCode >= 1.3.13
- Node.js >= 22
- `curl` available in PATH

## Install

```bash
npm install -g opencode-usage-plugin
```

Or install from GitHub:

```bash
npm install -g github:user/opencode-usage-plugin
```

## Setup

Add to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    ["opencode-usage-plugin/tui"]
  ]
}
```

Restart OpenCode. That's it.

The plugin automatically detects which providers are available and only shows the ones you have configured. No extra setup needed.

### Prefer running connectors in a subprocess?

```json
["opencode-usage-plugin/tui", { "command": "opencode-auth-usage" }]
```

## Options

Pass as the second element of the plugin tuple:

| Option | Default | Description |
|--------|---------|-------------|
| `command` | — | Run an external command instead of built-in connectors |
| `cwd` | — | Working directory for the external command |
| `interval_ms` | `60000` | Auto-refresh interval (ms) |
| `timeout_ms` | `8000` | Command timeout (ms) |
| `max_items` | `4` | Max rows shown in compact panels |
| `title` | `Usage` | Panel title |
| `show_home` | `true` | Show panel on home screen |
| `show_sidebar` | `true` | Show panel in session sidebar |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_AUTH_PATH` | `~/.local/share/opencode/auth.json` | Custom OpenCode auth file path |
| `OPENCODE_KIRO_DB_PATH` | `~/.config/opencode/kiro.db` | Custom Kiro database path |

## License

MIT
