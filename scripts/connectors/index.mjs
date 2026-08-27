import * as codex from "./codex.mjs"
import * as copilot from "./copilot.mjs"
import * as grok from "./grok.mjs"
import * as kiro from "./kiro.mjs"
import * as nvidia from "./nvidia.mjs"

export const connectorRegistry = {
  [copilot.name]: copilot,
  [kiro.name]: kiro,
  [codex.name]: codex,
  [nvidia.name]: nvidia,
  [grok.name]: grok,
}

export const allConnectorNames = Object.keys(connectorRegistry)
