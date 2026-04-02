#!/usr/bin/env node

import { connectorRegistry, allConnectorNames } from "./connectors/index.mjs"
import { buildSummary, defaultPaths, readEnv, readJson } from "./connectors/shared.mjs"

async function main() {
  const authPath = readEnv("OPENCODE_AUTH_PATH") ?? defaultPaths.auth
  let auth = {}
  try {
    auth = await readJson(authPath, "OpenCode auth file")
  } catch {
    // auth file missing — connectors will handle it gracefully
  }

  const items = []
  const warnings = []
  for (const name of allConnectorNames) {
    const connector = connectorRegistry[name]
    try {
      const result = await connector.run({ auth })
      items.push(...result.items)
      warnings.push(...result.warnings)
    } catch (error) {
      warnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        summary: buildSummary(items),
        items,
        warnings: warnings.length ? warnings : undefined,
        source: "opencode-connectors",
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
