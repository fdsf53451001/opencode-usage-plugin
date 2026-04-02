import * as copilot from "./copilot.mjs"
import * as kiro from "./kiro.mjs"

export const connectorRegistry = {
  [copilot.name]: copilot,
  [kiro.name]: kiro,
}

export const allConnectorNames = Object.keys(connectorRegistry)
