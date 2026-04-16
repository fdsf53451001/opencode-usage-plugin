import { access } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"

import {
  curlJson,
  defaultPaths,
  isPlaceholderEmail,
  isRecord,
  quotaItem,
  readEnv,
  readNumber,
  readString,
} from "./shared.mjs"

// Token refresh is intentionally not performed here.
// Refreshing from a read-only monitoring tool would consume Kiro's refresh token
// (AWS OIDC uses rotating single-use refresh tokens) without writing the new token
// back to the DB, which would break Kiro's own auth. Let Kiro handle its own rotation.

export const name = "kiro"

function getKiroAccounts(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db
      .prepare(
        "select id, email, region, profile_arn, access_token, expires_at, used_count, limit_count, last_sync, is_healthy from accounts",
      )
      .all()
  } finally {
    db.close()
  }
}

function preferKiroAccount(left, right) {
  const leftPlaceholder = isPlaceholderEmail(left.email)
  const rightPlaceholder = isPlaceholderEmail(right.email)
  if (leftPlaceholder !== rightPlaceholder) {
    return leftPlaceholder ? right : left
  }

  const leftProfile = readString(left.profile_arn) ? 1 : 0
  const rightProfile = readString(right.profile_arn) ? 1 : 0
  if (leftProfile !== rightProfile) {
    return rightProfile > leftProfile ? right : left
  }

  const leftScore = Number(left.limit_count || 0) + Number(left.last_sync || 0)
  const rightScore = Number(right.limit_count || 0) + Number(right.last_sync || 0)
  return rightScore > leftScore ? right : left
}

function chooseBestKiroAccounts(rows) {
  const healthy = rows.filter((row) => Number(row.is_healthy) === 1 && !isPlaceholderEmail(row.email))
  if (!healthy.length) return []

  const groups = new Map()
  for (const row of healthy) {
    const key = row.email || row.id
    const existing = groups.get(key)
    groups.set(key, existing ? preferKiroAccount(existing, row) : row)
  }

  return [...groups.values()]
}

function isTokenValid(account) {
  const expiresAt = Number(account.expires_at)
  if (!Number.isFinite(expiresAt)) return false
  return Date.now() < expiresAt - 120_000
}

async function fetchUsageWithToken(accessToken, account) {
  const url = new URL(`https://q.${account.region}.amazonaws.com/getUsageLimits`)
  url.searchParams.set("isEmailRequired", "true")
  url.searchParams.set("origin", "AI_EDITOR")
  url.searchParams.set("resourceType", "AGENTIC_REQUEST")
  if (readString(account.profile_arn)) {
    url.searchParams.set("profileArn", account.profile_arn)
  }

  const payload = await curlJson(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-amzn-kiro-agent-mode": "vibe",
      "amz-sdk-request": "attempt=1; max=1",
    },
  })

  if (payload?.message?.includes("bearer token")) {
    throw new Error("INVALID_TOKEN")
  }

  let usedCount = 0
  let limitCount = 0
  const breakdown = Array.isArray(payload?.usageBreakdownList) ? payload.usageBreakdownList : []
  for (const entry of breakdown) {
    if (!isRecord(entry)) continue
    if (isRecord(entry.freeTrialInfo)) {
      usedCount += readNumber(entry.freeTrialInfo.currentUsage) ?? 0
      limitCount += readNumber(entry.freeTrialInfo.usageLimit) ?? 0
    }
    usedCount += readNumber(entry.currentUsage) ?? 0
    limitCount += readNumber(entry.usageLimit) ?? 0
  }

  return {
    email: readString(payload?.userInfo?.email) ?? account.email,
    usedCount,
    limitCount,
    profileArn: readString(account.profile_arn),
  }
}

async function fetchKiroUsageForAccount(account) {
  const accessToken = readString(account.access_token)
  if (!accessToken || !isTokenValid(account)) return null
  return fetchUsageWithToken(accessToken, account)
}

export async function run() {
  const dbPath = readEnv("OPENCODE_KIRO_DB_PATH") ?? defaultPaths.kiroDb
  try {
    await access(dbPath)
  } catch {
    return { items: [], warnings: [] }
  }

  let rows
  try {
    rows = getKiroAccounts(dbPath)
  } catch (error) {
    return { items: [], warnings: [`Kiro DB read failed: ${error instanceof Error ? error.message : String(error)}`] }
  }

  const accounts = chooseBestKiroAccounts(rows)
  if (!accounts.length) {
    return { items: [], warnings: [] }
  }

  const items = []
  const warnings = []
  for (const account of accounts) {
    try {
      const usage = await fetchKiroUsageForAccount(account)
      if (!usage) continue
      if (!Number.isFinite(usage.limitCount) || usage.limitCount <= 0) {
        warnings.push(`Kiro usage limit missing for ${usage.email}`)
        continue
      }

      const remainingCount = Math.max(0, usage.limitCount - usage.usedCount)
      const usagePercentage = (usage.usedCount / usage.limitCount) * 100
      const remainingPercentage = (remainingCount / usage.limitCount) * 100
      const label = accounts.length > 1 ? `Kiro (${usage.email})` : "Kiro"
      const detail = [
        `${remainingCount}/${usage.limitCount} remaining`,
        usage.profileArn ? "IAM Identity Center" : undefined,
      ]
        .filter(Boolean)
        .join(" | ")

      items.push(
        quotaItem({
          id: `kiro:${usage.email}`,
          label,
          used: usagePercentage,
          remaining: remainingPercentage,
          detail,
        }),
      )
    } catch (error) {
      warnings.push(`Kiro ${account.email}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { items, warnings }
}
