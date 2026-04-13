import * as codex from "./codex.mjs"
import * as copilot from "./copilot.mjs"
import * as kiro from "./kiro.mjs"

export const connectorRegistry = {
  [copilot.name]: copilot,
  [kiro.name]: kiro,
  [codex.name]: codex,
}

export const allConnectorNames = Object.keys(connectorRegistry)
