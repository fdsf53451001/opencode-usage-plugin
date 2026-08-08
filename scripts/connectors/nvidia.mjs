import { access } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import { defaultPaths, quotaItem, readEnv, readString } from "./shared.mjs"

// NVIDIA removed the credits system from build.nvidia.com and exposes no usage
// API, so this connector estimates usage locally by counting this machine's
// OpenCode requests to the nvidia provider in opencode.db, per local day.
// One `step-start` part = one API request.

export const name = "nvidia"

const DEFAULT_DAILY_LIMIT = 1000
const RPM_LIMIT = 40

const COUNT_SQL = `
  select count(*) as total from part p
  join message m on p.message_id = m.id
  where m.data like '%"providerID":"nvidia"%'
    and json_extract(m.data, '$.providerID') = 'nvidia'
    and json_extract(p.data, '$.type') = 'step-start'
    and p.time_created >= ?
`

function countRequests(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const stmt = db.prepare(COUNT_SQL)
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    const today = Number(stmt.get(startOfToday)?.total) || 0
    const lastMinute = Number(stmt.get(Date.now() - 60_000)?.total) || 0
    return { today, lastMinute }
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

  const limit = Number(readEnv("OPENCODE_NVIDIA_DAILY_LIMIT")) || DEFAULT_DAILY_LIMIT
  const usedPct = (counts.today / limit) * 100

  return {
    items: [
      {
        ...quotaItem({
          id: "nvidia",
          label: "NVIDIA",
          used: usedPct,
          remaining: 100 - usedPct,
          detail: `RPD ${counts.today}/${limit} | RPM ${counts.lastMinute}/${RPM_LIMIT}`,
          // NVIDIA publishes no reset time; this is when the local counter rolls over.
          resetAt: new Date().setHours(24, 0, 0, 0),
        }),
        rpmUsed: counts.lastMinute,
        rpmLimit: RPM_LIMIT,
        countLabel: "RPD",
        usedCount: counts.today,
        limitCount: limit,
      },
    ],
    warnings: [],
  }
}
