import { curlJson, isRecord, parseResetAt, quotaItem, readNumber, readString } from "./shared.mjs"

export const name = "grok"

function readCents(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (!isRecord(value)) return undefined
  const raw = value.val
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function formatUsdFromCents(cents) {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`
}

function formatTier(tier) {
  const text = readString(tier)
  if (!text) return undefined
  return text.replace(/([a-z])([A-Z])/g, "$1 $2")
}

function formatPeriod(type) {
  const text = readString(type)
  if (!text) return undefined
  if (text.includes("WEEKLY")) return "weekly"
  if (text.includes("MONTHLY")) return "monthly"
  if (text.includes("DAILY")) return "daily"
  if (text.includes("SESSION")) return "session"
  return undefined
}

function grokAccessToken(auth) {
  for (const key of ["xai", "grok"]) {
    const token = readString(auth?.[key]?.access)
    if (token) return token
  }
  return undefined
}

export async function run(context) {
  const accessToken = grokAccessToken(context?.auth ?? {})
  if (!accessToken) return { items: [], warnings: [] }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "@yuting4281/opencode-usage-plugin/0.2.0",
  }

  const [billing, user] = await Promise.all([
    curlJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", { headers }),
    curlJson("https://cli-chat-proxy.grok.com/v1/user?include=subscription", { headers }).catch(() => ({})),
  ])

  const config = isRecord(billing?.config) ? billing.config : billing
  const period = isRecord(config?.currentPeriod) ? config.currentPeriod : undefined
  const plan = formatTier(isRecord(user) ? user.subscriptionTier : undefined)
  const periodLabel = formatPeriod(period?.type)
  const usedPct = readNumber(config?.creditUsagePercent)
  const onDemandUsed = readCents(config?.onDemandUsed) ?? 0
  const resetAt = parseResetAt(period?.end) ?? parseResetAt(config?.billingPeriodEnd)

  let usagePercentage = usedPct
  if (usagePercentage === undefined) {
    const used = readCents(config?.used) ?? 0
    const limit = readCents(config?.monthlyLimit) ?? 0
    usagePercentage = limit > 0 ? (used / limit) * 100 : 0
  }

  const detail = [
    plan ? `plan ${plan}` : undefined,
    periodLabel,
    onDemandUsed > 0 ? `${formatUsdFromCents(onDemandUsed)} on-demand` : undefined,
  ]
    .filter(Boolean)
    .join(" | ")

  return {
    items: [
      quotaItem({
        id: "grok",
        label: "Grok",
        used: usagePercentage,
        remaining: 100 - usagePercentage,
        detail: detail || undefined,
        resetAt,
      }),
    ],
    warnings: [],
  }
}
