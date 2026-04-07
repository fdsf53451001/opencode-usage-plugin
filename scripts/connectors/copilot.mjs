import { curlJson, quotaItem, readString } from "./shared.mjs"

export const name = "copilot"

export async function run(context) {
  const auth = context.auth
  const accessToken = auth?.["github-copilot"]?.access
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    return { items: [], warnings: [] }
  }

  const payload = await curlJson("https://api.github.com/copilot_internal/user", {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "X-Github-Api-Version": "2025-04-01",
      "User-Agent": "@fdsf53451001/opencode-usage-plugin/0.1.0",
    },
  })

  const premium = payload?.quota_snapshots?.premium_interactions
  const entitlement = Number(premium?.entitlement)
  const remaining = Number(premium?.remaining)
  if (!Number.isFinite(entitlement) || entitlement <= 0 || !Number.isFinite(remaining)) {
    throw new Error("GitHub Copilot response did not include premium interaction quota data")
  }

  const clampedRemaining = Math.max(0, Math.min(entitlement, remaining))
  const remainingPercentage = (clampedRemaining / entitlement) * 100
  const usagePercentage = 100 - remainingPercentage
  const detail = [
    `${Math.round(clampedRemaining)}/${Math.round(entitlement)} premium interactions left`,
    readString(payload?.copilot_plan) ? `plan ${payload.copilot_plan}` : undefined,
    Number.isFinite(Number(payload?.quota_snapshots?.chat?.remaining))
      ? `chat remaining ${Number(payload.quota_snapshots.chat.remaining)}`
      : undefined,
    Number.isFinite(Number(payload?.quota_snapshots?.completions?.remaining))
      ? `completions remaining ${Number(payload.quota_snapshots.completions.remaining)}`
      : undefined,
    readString(payload?.quota_reset_date) ? `resets ${payload.quota_reset_date}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ")

  return {
    items: [
      quotaItem({
        id: "github-copilot",
        label: "GitHub Copilot",
        used: usagePercentage,
        remaining: remainingPercentage,
        detail,
      }),
    ],
    warnings: [],
  }
}
