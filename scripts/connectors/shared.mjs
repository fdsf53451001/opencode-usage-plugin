import fs from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { promisify } from "node:util"

const execFile = promisify(execFileCallback)

export const defaultPaths = {
  auth: path.join(os.homedir(), ".local", "share", "opencode", "auth.json"),
  kiroDb: path.join(os.homedir(), ".config", "opencode", "kiro.db"),
}

export function readEnv(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, value))
}

export function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded.toFixed(0)}%` : `${rounded.toFixed(1)}%`
}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function quotaItem({ id, label, used, remaining, detail }) {
  return {
    id,
    label,
    usagePercentage: clampPercent(used),
    remainingPercentage: clampPercent(remaining),
    detail,
  }
}

export function buildSummary(items) {
  return items
    .slice(0, 4)
    .map((item) => `${item.label} ${formatPercent(item.usagePercentage)} used`)
    .join(" | ")
}

export async function readJson(filePath, label) {
  let raw
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch {
    throw new Error(`${label} not found: ${filePath}`)
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(`Failed to parse ${label}: ${filePath}`)
  }
}

export async function curlJson(url, options = {}) {
  const args = ["-sS", url]
  const headers = options.headers ?? {}

  for (const [name, value] of Object.entries(headers)) {
    args.push("-H", `${name}: ${value}`)
  }

  if (options.method) {
    args.push("-X", options.method)
  }

  if (options.body !== undefined) {
    args.push("--data-binary", options.body)
  }

  const { stdout, stderr } = await execFile("curl", args, {
    timeout: options.timeoutMs ?? 15000,
    maxBuffer: 1024 * 1024 * 2,
  })

  if (stderr?.trim()) {
    throw new Error(stderr.trim())
  }

  try {
    return JSON.parse(stdout)
  } catch {
    throw new Error(`Invalid JSON response from ${url}: ${stdout.slice(0, 200)}`)
  }
}

export function isPlaceholderEmail(email) {
  return typeof email === "string" && email.includes("placeholder") && email.endsWith("@awsapps.local")
}
