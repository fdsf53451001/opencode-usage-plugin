# @yuting4281/opencode-usage-plugin

OpenCode TUI plugin that shows your AI provider usage quota directly inside OpenCode.

Auto-detects available providers. Auto-refreshes every 60 seconds.

## Supported providers

| Provider | Auth source | What it shows |
|----------|-------------|---------------|
| GitHub Copilot | `~/.local/share/opencode/auth.json` | Premium interactions remaining %, plan type, reset date |
| Kiro | `~/.config/opencode/kiro.db` | Usage / limit per account, auto token refresh |

More providers coming soon.

## What you get

![usage interface](<resources/usage.png>)

- Collapsible usage panel on the home screen
- Collapsible usage panel in the session sidebar
- `/usage` command for a full-screen detailed view
- `/usage-refresh` command to manually refresh
- Color-coded progress bars (green → yellow → red as quota decreases)

## Requirements

- OpenCode >= 1.3.13
- Node.js >= 22

## Setup

This is a TUI-only plugin.

- Add it to `~/.config/opencode/tui.json`
- Do not add it to `~/.config/opencode/config.json`
- Restart OpenCode fully after changing the config

### Load from npm package

If the package is available from npm, add this to `~/.config/opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "@yuting4281/opencode-usage-plugin"
  ]
}
```

You usually do not need to run `npm install` manually for the TUI plugin itself. OpenCode reads the package name from `tui.json` and resolves/installs it through its own plugin system.

Use the package name only. Do not use `@yuting4281/opencode-usage-plugin/tui` in `tui.json`.

When installed from npm, OpenCode resolves the package's `./tui` export automatically. Users only need the package name in `tui.json`.

### Use a local checkout

For local development or if you cloned this repo directly, point `tui.json` at the plugin file:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/absolute/path/to/opencode-usage-plugin/tui.tsx"
  ]
}
```

Using an absolute path is the most reliable option for local installs.

## Optional helper command

The plugin works without this. Install it only if you want the `opencode-auth-usage` command on your `PATH`.

```bash
npm install -g @yuting4281/opencode-usage-plugin
```

Or install from GitHub:

```bash
npm install -g github:fdsf53451001/opencode-usage-plugin
```

The plugin automatically detects which providers are available and only shows the ones you have configured. No extra setup needed.

### Prefer running connectors in a subprocess?

Most users do not need this. If you want to force the plugin to use `opencode-auth-usage`, configure the same plugin spec with options:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "@yuting4281/opencode-usage-plugin",
      { "command": "opencode-auth-usage" }
    ]
  ]
}
```

If you are loading the plugin from a local checkout, replace `"@yuting4281/opencode-usage-plugin"` with the same absolute `tui.tsx` path you used above.

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

## Troubleshooting

- If the panel does not appear, make sure the plugin is only configured in `tui.json`
- For a local checkout, prefer an absolute path to `tui.tsx`
- After changing config, fully quit and reopen OpenCode
- Check the latest log in `~/.local/share/opencode/log/` for `service=tui.plugin` errors
- If the plugin is loaded, you should see the `Usage` panel and the `/usage` command

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCODE_AUTH_PATH` | `~/.local/share/opencode/auth.json` | Custom OpenCode auth file path |
| `OPENCODE_KIRO_DB_PATH` | `~/.config/opencode/kiro.db` | Custom Kiro database path |
