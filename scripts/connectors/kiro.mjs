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

export const name = "kiro"

function decodeRefreshToken(refreshToken) {
  const parts = refreshToken.split("|")
  if (parts.length < 2) {
    return { refreshToken, authMethod: "desktop" }
  }

  const authMethod = parts[parts.length - 1]
  if (authMethod === "idc") {
    return {
      refreshToken: parts[0],
      clientId: parts[1],
      clientSecret: parts[2],
      authMethod,
    }
  }

  return { refreshToken: parts[0], authMethod: "desktop" }
}

function getKiroAccounts(dbPath) {
  const db = new DatabaseSync(dbPath, { readonly: true })
  try {
    return db
      .prepare(
        "select id, email, auth_method, region, oidc_region, client_id, client_secret, profile_arn, refresh_token, access_token, expires_at, used_count, limit_count, last_sync, is_healthy from accounts",
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

async function refreshKiroAccessToken(account) {
  const authMethod = account.auth_method
  const region = account.region
  const oidcRegion = account.oidc_region || region
  const decoded = decodeRefreshToken(account.refresh_token)
  const isIdc = authMethod === "idc"

  const url = isIdc
    ? `https://oidc.${oidcRegion}.amazonaws.com/token`
    : `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`

  const body = isIdc
    ? {
        refreshToken: decoded.refreshToken,
        clientId: decoded.clientId ?? account.client_id,
        clientSecret: decoded.clientSecret ?? account.client_secret,
        grantType: "refresh_token",
      }
    : {
        refreshToken: decoded.refreshToken,
      }

  if (isIdc && (!body.clientId || !body.clientSecret)) {
    throw new Error(`Kiro account ${account.email} is missing IDC client credentials`)
  }

  const payload = await curlJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "amz-sdk-request": "attempt=1; max=1",
      "x-amzn-kiro-agent-mode": "vibe",
      "user-agent": isIdc
        ? "aws-sdk-js/3.738.0 ua/2.1 os/other lang/js md/browser#unknown_unknown api/sso-oidc#3.738.0 m/E KiroIDE"
        : "aws-sdk-js/3.0.0 KiroIDE-0.1.0 os/linux lang/js md/nodejs/25.2.1",
      Connection: "close",
    },
    body: JSON.stringify(body),
  })

  const accessToken = readString(payload?.access_token) ?? readString(payload?.accessToken)
  if (!accessToken) {
    throw new Error(`Kiro token refresh returned no access token for ${account.email}`)
  }

  return accessToken
}

function isTokenValid(account) {
  const expiresAt = Number(account.expires_at)
  if (!Number.isFinite(expiresAt)) return false
  return Date.now() < expiresAt - 120_000
}

async function getAccessToken(account) {
  if (isTokenValid(account) && readString(account.access_token)) {
    return account.access_token
  }
  return refreshKiroAccessToken(account)
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
  const token = await getAccessToken(account)

  try {
    return await fetchUsageWithToken(token, account)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === "INVALID_TOKEN" || message.includes("bearer token")) {
      const freshToken = await refreshKiroAccessToken(account)
      return fetchUsageWithToken(freshToken, account)
    }
    throw error
  }
}

export async function run() {
  const dbPath = readEnv("OPENCODE_KIRO_DB_PATH") ?? defaultPaths.kiroDb
  let rows
  try {
    rows = getKiroAccounts(dbPath)
  } catch {
    return { items: [], warnings: [] }
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
