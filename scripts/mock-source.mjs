const now = new Date().toISOString()

const payload = {
  summary: "Claude 68% used | Gemini CLI 15% used | MiniMax 4% used",
  items: [
    {
      id: "claude",
      label: "Claude",
      usagePercentage: 68,
      remainingPercentage: 32,
      detail: "32% left"
    },
    {
      id: "gemini_cli",
      label: "Gemini CLI",
      usagePercentage: 15,
      remainingPercentage: 85,
      detail: "85% left"
    },
    {
      id: "minimax_coding_plan",
      label: "MiniMax Coding Plan",
      usagePercentage: 4,
      remainingPercentage: 96,
      detail: "96% left"
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      cost: 12.42,
      detail: "$12.42 this month"
    }
  ],
  generatedAt: now
}

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
