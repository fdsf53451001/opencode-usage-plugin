import { access } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import { defaultPaths, quotaItem, readEnv, readString } from "./shared.mjs"

// NVIDIA removed the credits system from build.nvidia.com and exposes no usage
// API, so this connector estimates usage locally by counting this machine's
// OpenCode requests to the nvidia provider in opencode.db. One `step-start`
// part = one API request (matching the old 1 credit = 1 request model).

export const name = "nvidia"

const DEFAULT_CREDIT_LIMIT = 1000
const RPM_LIMIT = 40

const COUNT_SQL = `
  select count(*) as total from part p
  join message m on p.message_id = m.id
  where m.data like '%"providerID":"nvidia"%'
    and json_extract(m.data, '$.providerID') = 'nvidia'
    and json_extract(p.data, '$.type') = 'step-start'
`

function countRequests(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const total = Number(db.prepare(COUNT_SQL).get()?.total) || 0
    const lastMinute =
      Number(db.prepare(`${COUNT_SQL} and p.time_created >= ?`).get(Date.now() - 60_000)?.total) || 0
    return { total, lastMinute }
  } finally {
    db.close()
  }
}

export async function run(context) {
  const key = readString(context?.auth?.nvidia?.key)
  if (!key) {
    return { items: [], warnings: [] }
  }

  const dbPath = readEnv("OPENCODE_DB_PATH") ?? defaultPaths.opencodeDb
  try {
    await access(dbPath)
  } catch {
    return { items: [], warnings: [] }
  }

  let counts
  try {
    counts = countRequests(dbPath)
  } catch (error) {
    return { items: [], warnings: [`NVIDIA DB read failed: ${error instanceof Error ? error.message : String(error)}`] }
  }

  const limit = Number(readEnv("OPENCODE_NVIDIA_CREDIT_LIMIT")) || DEFAULT_CREDIT_LIMIT
  const usedPct = (counts.total / limit) * 100

  return {
    items: [
      quotaItem({
        id: "nvidia",
        label: "NVIDIA",
        used: usedPct,
        remaining: 100 - usedPct,
        detail: `${counts.total}/${limit} est. credits | ${counts.lastMinute}/${RPM_LIMIT} rpm`,
      }),
    ],
    warnings: [],
  }
}
