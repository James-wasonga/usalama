import { securityRules } from "./security.js"
import { privacyRules } from "./privacy.js"
import { dataDesignRules } from "./dataDesign.js"
import { censorshipRules, freshnessRules, openSourceRules } from "./freshness.js"
import type { StaticRule } from "../types.js"

/** Every static rule Usalama ships, across every pillar. Add new rules here. */
export const allRules: StaticRule[] = [
  ...securityRules,
  ...privacyRules,
  ...dataDesignRules,
  ...freshnessRules,
  ...openSourceRules,
  ...censorshipRules,
]

export { securityRules, privacyRules, dataDesignRules, freshnessRules, openSourceRules, censorshipRules }
