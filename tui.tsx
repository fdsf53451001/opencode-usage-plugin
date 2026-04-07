/** @jsxImportSource @opentui/solid */
import { useKeyboard } from "@opentui/solid"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { exec as execCallback } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { For, Show, createMemo, createSignal } from "solid-js"

const exec = promisify(execCallback)

const id = "opencode.usage-bar"
const routeName = "opencode.usage-bar.screen"

type PluginConfig = {
  title: string
  command?: string
  cwd?: string
  intervalMs: number
  timeoutMs: number
  maxItems: number
  showHome: boolean
  showSidebar: boolean
  cacheKey: string
}

type UsageItem = {
  id: string
  label: string
  kind: "quota" | "cost"
  used?: number
  remaining?: number
  detail?: string
  cost?: number
}

type Snapshot = {
  source: "native" | "opencodebar" | "builtin"
  updatedAt: number
  items: UsageItem[]
  summary: string
  command?: string
  totalCost?: number
}

type FetchState = {
  loading: boolean
  snapshot?: Snapshot
  error?: string
}

const knownLabels: Record<string, string> = {
  brave_search: "Brave Search",
  chutes_ai: "Chutes AI",
  claude: "Claude",
  codex: "Codex",
  gemini_cli: "Gemini CLI",
  github_copilot: "GitHub Copilot",
  github_copilot_add_on: "GitHub Copilot Add-on",
  kimi_for_coding: "Kimi for Coding",
  minimax_coding_plan: "MiniMax Coding Plan",
  nano_gpt: "Nano-GPT",
  opencode_zen: "OpenCode Zen",
  openrouter: "OpenRouter",
  synthetic: "Synthetic",
  tavily: "Tavily",
  z_ai_coding_plan: "Z.AI Coding Plan",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function parsePercent(value: unknown): number | undefined {
  const direct = readNumber(value)
  if (direct !== undefined) return clampPercent(direct)
  if (typeof value !== "string") return undefined
  const matches = value.match(/\d+(?:\.\d+)?/g)
  if (!matches?.length) return undefined
  const numbers = matches
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
  if (!numbers.length) return undefined
  return clampPercent(Math.max(...numbers))
}

function formatPercent(value: number | undefined): string {
  if (value === undefined) return "--"
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

function formatMoney(value: number | undefined): string {
  if (value === undefined) return "$0.00"
  return `$${value.toFixed(2)}`
}

function humanizeProvider(id: string): string {
  const known = knownLabels[id]
  if (known) return known
  return id
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

function percentBar(value: number | undefined, width = 12): string {
  if (value === undefined) return `[${"-".repeat(width)}]`
  const fill = Math.round((clampPercent(value) / 100) * width)
  return `[${"#".repeat(fill)}${"-".repeat(width - fill)}]`
}

function itemTone(api: TuiPluginApi, value: number | undefined) {
  const theme = api.theme.current
  if (value === undefined) return theme.textMuted
  if (value >= 85) return theme.error
  if (value >= 60) return theme.warning
  return theme.success
}

function formatUpdatedAt(timestamp: number | undefined): string {
  if (!timestamp) return "never"
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error.trim()
  return "Unknown usage command error"
}

function quotaItems(snapshot: Snapshot | undefined, maxItems: number): UsageItem[] {
  if (!snapshot) return []
  return snapshot.items.filter((item) => item.kind === "quota").slice(0, maxItems)
}

function costItems(snapshot: Snapshot | undefined): UsageItem[] {
  if (!snapshot) return []
  return snapshot.items.filter((item) => item.kind === "cost")
}

function sortItems(items: UsageItem[]): UsageItem[] {
  return [...items].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "quota" ? -1 : 1
    if (left.kind === "quota" && right.kind === "quota") {
      return (right.used ?? -1) - (left.used ?? -1) || left.label.localeCompare(right.label)
    }
    return left.label.localeCompare(right.label)
  })
}

function buildSummary(items: UsageItem[], totalCost?: number): string {
  const quotas = items.filter((item) => item.kind === "quota")
  const quotaSummary = quotas
    .slice(0, 3)
    .map((item) => `${item.label} ${formatPercent(item.used)} used`)
    .join(" | ")

  if (quotaSummary && totalCost !== undefined) {
    return `${quotaSummary} | ${formatMoney(totalCost)} paygo`
  }
  if (quotaSummary) return quotaSummary
  if (totalCost !== undefined) return `${formatMoney(totalCost)} paygo`
  return "No usage data"
}

function normalizeNative(raw: Record<string, unknown>, config: PluginConfig): Snapshot {
  const input = Array.isArray(raw.items) ? raw.items : []
  const items: UsageItem[] = []

  input.forEach((entry, index) => {
    if (!isRecord(entry)) return
    const label = readString(entry.label) ?? humanizeProvider(readString(entry.id) ?? `item_${index + 1}`)
    const used = parsePercent(entry.used ?? entry.usage ?? entry.usagePercentage ?? entry.usedPercentage)
    const remaining =
      parsePercent(entry.remaining ?? entry.remainingPercentage) ?? (used !== undefined ? clampPercent(100 - used) : undefined)
    const detail =
      readString(entry.detail) ??
      readString(entry.remainingText) ??
      (remaining !== undefined ? `${formatPercent(remaining)} left` : undefined)
    const cost = readNumber(entry.cost)

    if (cost !== undefined && used === undefined) {
      items.push({
        id: readString(entry.id) ?? `cost_${index + 1}`,
        label,
        kind: "cost",
        cost,
        detail: detail ?? formatMoney(cost),
      })
      return
    }

    if (used === undefined) return
    items.push({
      id: readString(entry.id) ?? `quota_${index + 1}`,
      label,
      kind: "quota",
      used,
      remaining,
      detail,
    })
  })

  const totalCost = items
    .filter((item) => item.kind === "cost")
    .reduce((sum, item) => sum + (item.cost ?? 0), 0)

  return {
    source: "native",
    updatedAt: Date.now(),
    items: sortItems(items),
    summary: readString(raw.summary) ?? buildSummary(items, totalCost || undefined),
    command: config.command,
    totalCost: totalCost || undefined,
  }
}

function normalizeOpencodebar(raw: Record<string, unknown>, config: PluginConfig): Snapshot {
  const items: UsageItem[] = []

  Object.entries(raw).forEach(([providerID, entry]) => {
    if (!isRecord(entry)) return

    const type = readString(entry.type)
    if (!type) return

    if (type === "quota-based") {
      const accounts = Array.isArray(entry.accounts) ? entry.accounts : []
      const remainingCount = readNumber(entry.remaining)
      const entitlement = readNumber(entry.entitlement)
      let remaining = parsePercent(entry.remainingPercentage)
      let used = parsePercent(entry.usagePercentage)

      if (used === undefined && remainingCount !== undefined && entitlement && entitlement > 0) {
        remaining = clampPercent((remainingCount / entitlement) * 100)
      }

      if (used === undefined && remaining === undefined && accounts.length > 0) {
        const derived = accounts
          .map((account) => {
            if (!isRecord(account)) return undefined
            const accountUsed = parsePercent(account.usagePercentage)
            if (accountUsed !== undefined) return accountUsed
            const accountRemaining = parsePercent(account.remainingPercentage)
            return accountRemaining !== undefined ? clampPercent(100 - accountRemaining) : undefined
          })
          .filter((value): value is number => value !== undefined)
        if (derived.length) used = Math.max(...derived)
      }

      if (used === undefined && remaining !== undefined) used = clampPercent(100 - remaining)
      if (remaining === undefined && used !== undefined) remaining = clampPercent(100 - used)
      if (used === undefined) return

      let detail: string | undefined
      if (remainingCount !== undefined && entitlement !== undefined && entitlement > 0) {
        detail = `${Math.round(remainingCount)}/${Math.round(entitlement)} remaining`
      } else if (remaining !== undefined) {
        detail = `${formatPercent(remaining)} left`
      } else if (accounts.length > 1) {
        detail = `${accounts.length} accounts`
      }

      const rawUsage = readString(entry.usagePercentage)
      if (!detail && rawUsage) detail = rawUsage

      items.push({
        id: providerID,
        label: humanizeProvider(providerID),
        kind: "quota",
        used,
        remaining,
        detail,
      })
      return
    }

    if (type === "pay-as-you-go") {
      const cost = readNumber(entry.cost)
      if (cost === undefined) return
      items.push({
        id: providerID,
        label: humanizeProvider(providerID),
        kind: "cost",
        cost,
        detail: formatMoney(cost),
      })
    }
  })

  const totalCost = items
    .filter((item) => item.kind === "cost")
    .reduce((sum, item) => sum + (item.cost ?? 0), 0)

  return {
    source: "opencodebar",
    updatedAt: Date.now(),
    items: sortItems(items),
    summary: buildSummary(items, totalCost || undefined),
    command: config.command,
    totalCost: totalCost || undefined,
  }
}

function normalizePayload(raw: unknown, config: PluginConfig): Snapshot {
  if (!isRecord(raw)) {
    throw new Error("Usage command must output a JSON object")
  }

  if (Array.isArray(raw.items)) {
    return normalizeNative(raw, config)
  }

  return normalizeOpencodebar(raw, config)
}

function readConfig(options: Record<string, unknown> | undefined): PluginConfig {
  const interval = readNumber(options?.interval_ms)
  const timeout = readNumber(options?.timeout_ms)
  const maxItems = readNumber(options?.max_items)

  return {
    title: readString(options?.title) ?? "Usage",
    command: readString(options?.command),
    cwd: readString(options?.cwd),
    intervalMs: Math.max(5000, interval ?? 60_000),
    timeoutMs: Math.max(1000, timeout ?? 8_000),
    maxItems: Math.max(1, Math.min(8, Math.round(maxItems ?? 4))),
    showHome: readBoolean(options?.show_home, true),
    showSidebar: readBoolean(options?.show_sidebar, true),
    cacheKey: readString(options?.cache_key) ?? `${id}.snapshot`,
  }
}

// ── Built-in connectors ──────────────────────────────────────────────

const AUTH_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")
const KIRO_DB_PATH = join(homedir(), ".config", "opencode", "kiro.db")

type ConnectorResult = {
  items: { id: string; label: string; usagePercentage: number; remainingPercentage: number; detail?: string }[]
  warnings: string[]
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8")
  return JSON.parse(raw)
}

function isPlaceholderEmail(email: string): boolean {
  return email.includes("placeholder") && email.endsWith("@awsapps.local")
}

async function copilotConnector(): Promise<ConnectorResult> {
  let auth: Record<string, unknown>
  try {
    auth = (await readJsonFile(AUTH_PATH)) as Record<string, unknown>
  } catch {
    return { items: [], warnings: [] }
  }

  const entry = auth["github-copilot"] as Record<string, unknown> | undefined
  const accessToken = typeof entry?.access === "string" ? entry.access.trim() : ""
  if (!accessToken) {
    return { items: [], warnings: [] }
  }

  const res = await fetch("https://api.github.com/copilot_internal/user", {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.96.2",
      "X-Github-Api-Version": "2025-04-01",
      "User-Agent": "@fdsf53451001/opencode-usage-plugin/0.1.0",
    },
  })

  if (!res.ok) throw new Error(`Copilot API ${res.status}`)
  const payload = (await res.json()) as Record<string, unknown>
  const premium = (payload.quota_snapshots as Record<string, unknown>)?.premium_interactions as Record<string, unknown> | undefined
  const entitlement = Number(premium?.entitlement)
  const remaining = Number(premium?.remaining)
  if (!Number.isFinite(entitlement) || entitlement <= 0 || !Number.isFinite(remaining)) {
    throw new Error("Copilot quota data missing")
  }

  const clamped = Math.max(0, Math.min(entitlement, remaining))
  const remainPct = (clamped / entitlement) * 100
  const usedPct = 100 - remainPct
  const plan = typeof payload.copilot_plan === "string" ? payload.copilot_plan : "unknown"
  const resetDate = typeof payload.quota_reset_date === "string" ? payload.quota_reset_date : undefined
  const detail = [`${Math.round(clamped)}/${Math.round(entitlement)} left`, `plan ${plan}`, resetDate ? `resets ${resetDate}` : undefined].filter(Boolean).join(" | ")

  return {
    items: [{ id: "github-copilot", label: "GitHub Copilot", usagePercentage: clampPercent(usedPct), remainingPercentage: clampPercent(remainPct), detail }],
    warnings: [],
  }
}

type SqliteDBCtor = new (path: string, opts?: unknown) => unknown

async function kiroConnector(): Promise<ConnectorResult> {
  let Database: SqliteDBCtor | undefined
  try {
    const mod = await import("bun:sqlite" as string)
    Database = (mod as unknown as { Database: SqliteDBCtor }).Database ?? (mod as unknown as { default: { Database: SqliteDBCtor } }).default?.Database
  } catch {
    try {
      const mod = await import("node:sqlite" as string)
      Database = (mod as unknown as { DatabaseSync: unknown }).DatabaseSync as unknown as SqliteDBCtor
    } catch {
      return { items: [], warnings: [] }
    }
  }

  if (!Database) return { items: [], warnings: [] }

  let rows: Array<Record<string, unknown>>
  try {
    const db = new Database(KIRO_DB_PATH, { readonly: true } as Record<string, unknown>)
    try {
      const stmt = (db as unknown as { prepare(sql: string): { all(): Array<Record<string, unknown>> } }).prepare(
        "select email, auth_method, region, oidc_region, profile_arn, refresh_token, client_id, client_secret, access_token, expires_at, used_count, limit_count, last_sync, is_healthy from accounts",
      )
      rows = stmt.all()
    } finally {
      ;(db as unknown as { close(): void }).close()
    }
  } catch {
    return { items: [], warnings: [] }
  }

  const healthy = rows.filter((r) => Number(r.is_healthy) === 1 && !isPlaceholderEmail(String(r.email ?? "")))
  if (!healthy.length) return { items: [], warnings: [] }

  // Group by email, prefer accounts with profile_arn
  const groups = new Map<string, Record<string, unknown>>()
  for (const row of healthy) {
    const key = String(row.email)
    const existing = groups.get(key)
    if (!existing) { groups.set(key, row); continue }
    const existingHasProfile = typeof existing.profile_arn === "string" && existing.profile_arn
    const rowHasProfile = typeof row.profile_arn === "string" && row.profile_arn
    if (rowHasProfile && !existingHasProfile) groups.set(key, row)
  }

  const accounts = [...groups.values()]
  const items: ConnectorResult["items"] = []
  const warnings: string[] = []

  for (const account of accounts) {
    try {
      // Try exisaccess_token first, refresh if expired
      let accessToken = typeof account.access_token === "string" ? account.access_token : ""
      const expiresAt = Number(account.expires_at)
      const isExpired = !Number.isFinite(expiresAt) || Date.now() >= expiresAt - 120_000

      if (isExpired || !accessToken) {
        accessToken = await refreshKiroToken(account)
      }

      const usage = await fetchKiroUsage(accessToken, account)
      if (usage.limitCount <= 0) { warnings.push(`Kiro limit missing for ${account.email}`); continue }

      const remainingCount = Math.max(0, usage.limitCount - usage.usedCount)
      const usedPct = (usage.usedCount / usage.limitCount) * 100
      const remainPct = (remainingCount / usage.limitCount) * 100
      const label = accounts.length > 1 ? `Kiro (${usage.email})` : "Kiro"
      const detail = [`${remainingCount}/${usage.limitCount} remaining`, account.profile_arn ? "IAM Identity Center" : undefined].filter(Boolean).join(" | ")

      items.push({ id: `kiro:${usage.email}`, label, usagePercentage: clampPercent(usedPct), remainingPercentage: clampPercent(remainPct), detail })
    } catch (error) {
      // If direct token failed, try refresh
      try {
        const freshToken = await refreshKiroToken(account)
        const usage = await fetchKiroUsage(freshToken, account)
        if (usage.limitCount <= 0) { warnings.push(`Kiro limit missing for ${account.email}`); continue }
        const remainingCount = Math.max(0, usage.limitCount - usage.usedCount)
        const usedPct = (usage.usedCount / usage.limitCount) * 100
        const remainPct = (remainingCount / usage.limitCount) * 100
        const label = accounts.length > 1 ? `Kiro (${usage.email})` : "Kiro"
        const detail = [`${remainingCount}/${usage.limitCount} remaining`, account.profile_arn ? "IAM Identity Center" : undefined].filter(Boolean).join(" | ")
        items.push({ id: `kiro:${usage.email}`, label, usagePercentage: clampPercent(usedPct), remainingPercentage: clampPercent(remainPct), detail })
      } catch (retryError) {
        warnings.push(`Kiro ${account.email}: ${retryError instanceof Error ? retryError.message : String(retryError)}`)
      }
    }
  }

  return { items, warnings }
}

async function refreshKiroToken(account: Record<string, unknown>): Promise<string> {
  const authMethod = String(account.auth_method ?? "desktop")
  const region = String(account.region ?? "us-east-1")
  const oidcRegion = String(account.oidc_region || region)
  const refreshToken = String(account.refresh_token ?? "")
  const clientId = String(account.client_id ?? "")
  const clientSecret = String(account.client_secret ?? "")
  const isIdc = authMethod === "idc"

  const url = isIdc
    ? `https://oidc.${oidcRegion}.amazonaws.com/token`
    : `https://prod.${region}.auth.desktop.kiro.dev/refreshToken`

  const body = isIdc
    ? { refreshToken, clientId, clientSecret, grantType: "refresh_token" }
    : { refreshToken }

  if (isIdc && (!clientId || !clientSecret)) {
    throw new Error(`Missing IDC credentials for ${account.email}`)
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "amz-sdk-request": "attempt=1; max=1",
      "x-amzn-kiro-agent-mode": "vibe",
      Connection: "close",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`Kiro token refresh failed: ${res.status}`)
  const data = (await res.json()) as Record<string, unknown>
  const token = (typeof data.access_token === "string" ? data.access_token : typeof data.accessToken === "string" ? data.accessToken : "").trim()
  if (!token) throw new Error(`No access token returned for ${account.email}`)
  return token
}

async function fetchKiroUsage(accessToken: string, account: Record<string, unknown>): Promise<{ email: string; usedCount: number; limitCount: number }> {
  const region = String(account.region ?? "us-east-1")
  const profileArn = typeof account.profile_arn === "string" ? account.profile_arn : ""
  const url = new URL(`https://q.${region}.amazonaws.com/getUsageLimits`)
  url.searchParams.set("isEmailRequired", "true")
  url.searchParams.set("origin", "AI_EDITOR")
  url.searchParams.set("resourceType", "AGENTIC_REQUEST")
  if (profileArn) url.searchParams.set("profileArn", profileArn)

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-amzn-kiro-agent-mode": "vibe",
      "amz-sdk-request": "attempt=1; max=1",
    },
  })

  if (!res.ok) throw new Error(`Kiro usage API ${res.status}`)
  const data = (await res.json()) as Record<string, unknown>

  if (typeof data.message === "string" && data.message.includes("bearer token")) {
    throw new Error("INVALID_TOKEN")
  }

  let usedCount = 0
  let limitCount = 0
  const breakdown = Array.isArray(data.usageBreakdownList) ? data.usageBreakdownList : []
  for (const entry of breakdown) {
    if (!isRecord(entry)) continue
    if (isRecord(entry.freeTrialInfo)) {
      usedCount += Number(entry.freeTrialInfo.currentUsage) || 0
      limitCount += Number(entry.freeTrialInfo.usageLimit) || 0
    }
    usedCount += Number(entry.currentUsage) || 0
    limitCount += Number(entry.usageLimit) || 0
  }

  const email = typeof data.userInfo === "object" && data.userInfo !== null && typeof (data.userInfo as Record<string, unknown>).email === "string"
    ? ((data.userInfo as Record<string, unknown>).email as string)
    : String(account.email ?? "unknown")

  return { email, usedCount, limitCount }
}

const builtinConnectors: Record<string, () => Promise<ConnectorResult>> = {
  copilot: copilotConnector,
  kiro: kiroConnector,
}

async function loadBuiltinSnapshot(config: PluginConfig): Promise<Snapshot> {
  const allItems: UsageItem[] = []
  const allWarnings: string[] = []

  for (const [name, connector] of Object.entries(builtinConnectors)) {
    try {
      const result = await connector()
      for (const item of result.items) {
        allItems.push({
          id: item.id,
          label: item.label,
          kind: "quota",
          used: item.usagePercentage,
          remaining: item.remainingPercentage,
          detail: item.detail,
        })
      }
      allWarnings.push(...result.warnings)
    } catch (error) {
      allWarnings.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!allItems.length && allWarnings.length) {
    throw new Error(allWarnings.join(" | "))
  }

  return {
    source: "builtin",
    updatedAt: Date.now(),
    items: sortItems(allItems),
    summary: buildSummary(allItems),
  }
}

// ── Snapshot loading (builtin or command) ────────────────────────────

async function loadSnapshot(api: TuiPluginApi, config: PluginConfig): Promise<Snapshot> {
  if (!config.command) {
    return loadBuiltinSnapshot(config)
  }

  const shell = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh")
  const result = await exec(config.command, {
    cwd: config.cwd ?? api.state.path.directory ?? process.cwd(),
    shell,
    timeout: config.timeoutMs,
    maxBuffer: 1024 * 1024,
    env: process.env,
  })

  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  if (!stdout) {
    throw new Error(stderr || "Usage command returned no output")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    const prefix = stdout.slice(0, 160)
    throw new Error(`Usage command did not return valid JSON: ${prefix}`)
  }

  return normalizePayload(parsed, config)
}

function Row(props: { api: TuiPluginApi; item: UsageItem; detailed?: boolean }) {
  const theme = () => props.api.theme.current
  const usedTone = () => itemTone(props.api, props.item.used)

  return (
    <box flexDirection="column" gap={props.detailed ? 1 : 0}>
      <box flexDirection="row" gap={1} justifyContent="space-between">
        <text fg={theme().text} wrapMode="none">
          {props.item.label}
        </text>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <Show when={props.item.kind === "quota"}>
            <text fg={usedTone()}>{percentBar(props.item.used)}</text>
            <text fg={usedTone()}>{formatPercent(props.item.used)}</text>
            <Show when={props.item.remaining !== undefined}>
              <text fg={theme().textMuted}>{formatPercent(props.item.remaining)} left</text>
            </Show>
          </Show>
          <Show when={props.item.kind === "cost"}>
            <text fg={theme().accent}>{formatMoney(props.item.cost)}</text>
          </Show>
        </box>
      </box>
      <Show when={props.detailed && props.item.detail}>
        <text fg={theme().textMuted}>{props.item.detail}</text>
      </Show>
    </box>
  )
}

function SummaryPanel(props: {
  api: TuiPluginApi
  config: PluginConfig
  state: () => FetchState
  variant: "home" | "sidebar"
  onRefresh: () => void
}) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const snapshot = createMemo(() => props.state().snapshot)
  const items = createMemo(() => quotaItems(snapshot(), props.config.maxItems))
  const costs = createMemo(() => costItems(snapshot()))
  const hasContent = createMemo(() => props.state().loading || !!snapshot() || !!props.state().error)

  return (
    <Show when={hasContent()}>
      <box
        width="100%"
        maxWidth={props.variant === "home" ? 75 : undefined}
        paddingTop={props.variant === "home" ? 1 : 0}
        flexShrink={0}
        flexDirection="column"
        gap={1}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1} onMouseDown={() => setOpen((value) => !value)}>
            <text fg={theme().text}>
              {open() ? "▼" : "▶"}
            </text>
            <text fg={theme().text}>
              <b>{props.config.title}</b>
            </text>
          </box>
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme().textMuted} onMouseUp={() => props.onRefresh()}>
              refresh
            </text>
            <text fg={theme().textMuted} onMouseUp={() => props.api.route.navigate(routeName)}>
              /usage
            </text>
          </box>
        </box>

        <Show when={open()}>
          <box flexDirection="column" gap={1}>
            <Show when={props.state().loading && !snapshot()}>
              <text fg={theme().textMuted}>Loading usage data...</text>
            </Show>

            <Show when={snapshot()}>
              <text fg={theme().textMuted}>{snapshot()!.summary}</text>
              <For each={items()}>{(item) => <Row api={props.api} item={item} />}</For>
              <Show when={costs().length > 0 && snapshot()!.totalCost !== undefined}>
                <text fg={theme().accent}>Pay as you go {formatMoney(snapshot()!.totalCost)}</text>
              </Show>
              <text fg={theme().textMuted}>Updated {formatUpdatedAt(snapshot()!.updatedAt)}</text>
            </Show>

            <Show when={props.state().error}>
              <text fg={snapshot() ? theme().warning : theme().error}>
                {snapshot() ? `Showing cached data: ${props.state().error}` : props.state().error}
              </text>
            </Show>
          </box>
        </Show>
      </box>
    </Show>
  )
}

function UsageScreen(props: { api: TuiPluginApi; config: PluginConfig; state: () => FetchState; onRefresh: () => void }) {
  const theme = () => props.api.theme.current
  const keys = props.api.keybind.create({
    close: "escape",
    refresh: "r",
  })
  const snapshot = createMemo(() => props.state().snapshot)
  const quotas = createMemo(() => quotaItems(snapshot(), Number.MAX_SAFE_INTEGER))
  const costs = createMemo(() => costItems(snapshot()))

  useKeyboard((evt) => {
    if (props.api.route.current.name !== routeName) return
    if (keys.match("close", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.api.route.navigate("home")
      return
    }
    if (keys.match("refresh", evt)) {
      evt.preventDefault()
      evt.stopPropagation()
      props.onRefresh()
    }
  })

  return (
    <box width="100%" height="100%" backgroundColor={theme().background} paddingTop={1} paddingBottom={1}>
      <box paddingLeft={2} paddingRight={2} gap={1} flexDirection="column">
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <text fg={theme().text}>
            <b>{props.config.title}</b>
          </text>
          <text fg={theme().textMuted}>
            {keys.print("refresh")} refresh · {keys.print("close")} home
          </text>
        </box>

        <Show when={snapshot()}>
          <text fg={theme().textMuted}>{snapshot()!.summary}</text>
          <text fg={theme().textMuted}>Source {snapshot()!.source}</text>
          <text fg={theme().textMuted}>Updated {formatUpdatedAt(snapshot()!.updatedAt)}</text>
          <text fg={theme().textMuted}>Command {snapshot()!.command}</text>
        </Show>

        <Show when={props.state().loading && !snapshot()}>
          <text fg={theme().textMuted}>Loading usage data...</text>
        </Show>

        <Show when={quotas().length > 0}>
          <text fg={theme().text}>
            <b>Quota</b>
          </text>
          <For each={quotas()}>{(item) => <Row api={props.api} item={item} detailed />}</For>
        </Show>

        <Show when={costs().length > 0}>
          <text fg={theme().text}>
            <b>Pay as you go</b>
          </text>
          <For each={costs()}>{(item) => <Row api={props.api} item={item} detailed />}</For>
        </Show>

        <Show when={!props.state().loading && quotas().length === 0 && costs().length === 0 && !props.state().error}>
          <text fg={theme().textMuted}>No usage items were found in the JSON output.</text>
        </Show>

        <Show when={props.state().error}>
          <text fg={snapshot() ? theme().warning : theme().error}>{props.state().error}</text>
        </Show>
      </box>
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  const config = readConfig(options)
  const cached = api.kv.get<Snapshot | undefined>(config.cacheKey)
  const [state, setState] = createSignal<FetchState>(cached ? { loading: false, snapshot: cached } : { loading: true })

  let inflight = false

  const refresh = async (manual: boolean) => {
    if (inflight) return
    inflight = true
    if (!state().snapshot) {
      setState((current) => ({ ...current, loading: true, error: undefined }))
    }

    try {
      const snapshot = await loadSnapshot(api, config)
      api.kv.set(config.cacheKey, snapshot)
      setState({ loading: false, snapshot, error: undefined })
      if (manual) {
        api.ui.toast({
          variant: "success",
          message: `${config.title} updated`,
          duration: 2500,
        })
      }
    } catch (error) {
      const message = toErrorMessage(error)
      setState((current) => ({
        loading: false,
        snapshot: current.snapshot,
        error: message,
      }))
      if (manual) {
        api.ui.toast({
          variant: "error",
          title: config.title,
          message,
          duration: 5000,
        })
      }
    } finally {
      inflight = false
    }
  }

  api.command.register(() => [
    {
      title: `Open ${config.title.toLowerCase()}`,
      value: `${id}.open`,
      category: "System",
      slash: {
        name: "usage",
      },
      onSelect: () => {
        api.route.navigate(routeName)
        api.ui.dialog.clear()
      },
    },
    {
      title: `Refresh ${config.title.toLowerCase()}`,
      value: `${id}.refresh`,
      category: "System",
      slash: {
        name: "usage-refresh",
      },
      onSelect: () => {
        void refresh(true)
        api.ui.dialog.clear()
      },
    },
  ])

  api.route.register([
    {
      name: routeName,
      render: () => <UsageScreen api={api} config={config} state={state} onRefresh={() => void refresh(true)} />,
    },
  ])

  api.slots.register({
    order: 320,
    slots: {
      home_bottom() {
        if (!config.showHome) return null
        return <SummaryPanel api={api} config={config} state={state} variant="home" onRefresh={() => void refresh(true)} />
      },
      sidebar_content() {
        if (!config.showSidebar) return null
        return (
          <SummaryPanel api={api} config={config} state={state} variant="sidebar" onRefresh={() => void refresh(true)} />
        )
      },
    },
  })

  void refresh(false)
  const timer = setInterval(() => {
    void refresh(false)
  }, config.intervalMs)

  api.lifecycle.onDispose(() => {
    clearInterval(timer)
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
