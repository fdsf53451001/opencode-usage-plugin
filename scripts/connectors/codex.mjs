import { curlJson, isRecord, quotaItem, readNumber, readString } from "./shared.mjs"

export const name = "codex"

function parseJwtPayload(token) {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
  } catch {
    return null
  }
}

export async function run(context) {
  let accessToken = ""

  // Try opencode auth.json keys
  const auth = context?.auth ?? {}
  for (const key of ["openai", "codex", "chatgpt"]) {
    const token = readString(auth?.[key]?.access)
    if (token) {
      accessToken = token
      break
    }
  }

  if (!accessToken) return { items: [], warnings: [] }

  // Extract chatgpt_account_id from JWT payload for account-scoped requests
  // The claim is nested under "https://api.openai.com/auth" in OpenCode-issued tokens
  const jwtPayload = parseJwtPayload(accessToken)
  const authClaims = isRecord(jwtPayload?.["https://api.openai.com/auth"])
    ? jwtPayload["https://api.openai.com/auth"]
    : jwtPayload
  const accountId = readString(authClaims?.chatgpt_account_id)

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  }
  if (accountId) headers["ChatGPT-Account-Id"] = accountId

  const payload = await curlJson("https://chatgpt.com/backend-api/wham/usage", { headers })

  const rateLimit = isRecord(payload?.rate_limit) ? payload.rate_limit : undefined
  const primary = isRecord(rateLimit?.primary_window) ? rateLimit.primary_window : undefined
  const secondary = isRecord(rateLimit?.secondary_window) ? rateLimit.secondary_window : undefined
  const planType = readString(payload?.plan_type)

  if (!primary) return { items: [], warnings: [] }

  const usedPct = readNumber(primary?.used_percent)
  if (usedPct === undefined) return { items: [], warnings: [] }

  const remainPct = 100 - usedPct
  const resetAfter = readNumber(primary?.reset_after_seconds)
  const weeklyUsed = readNumber(secondary?.used_percent)

  const detail = [
    planType ? `plan ${planType}` : undefined,
    resetAfter !== undefined ? `resets in ${Math.ceil(resetAfter / 60)}m` : undefined,
    weeklyUsed !== undefined ? `weekly ${weeklyUsed.toFixed(0)}% used` : undefined,
  ]
    .filter(Boolean)
    .join(" | ")

  return {
    items: [quotaItem({ id: "codex", label: "Codex", used: usedPct, remaining: remainPct, detail: detail || undefined })],
    warnings: [],
  }
}
