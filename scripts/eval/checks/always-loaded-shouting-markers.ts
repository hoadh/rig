/**
 * Tier 1 check: always-loaded instruction files must not use shouting markers.
 *
 * CLAUDE.md, AGENTS.md and the plugin core rules (plugins/rig/rules/*.md) load into every session. Emphasis
 * words like NON-NEGOTIABLE cause over-triggering on current models; state the
 * rule plainly with a one-line reason instead.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { CheckResult } from "../eval-utils.ts";

const SHOUTING = /NON-NEGOTIABLE|NO EXCEPTIONS|MANDATORY/;

export function validateAlwaysLoadedShoutingMarkers(root: string): CheckResult {
  const files = ["CLAUDE.md", "AGENTS.md"].map((f) => join(root, f));
  const rulesDir = join(root, "plugins/rig/rules");
  if (existsSync(rulesDir)) {
    for (const f of readdirSync(rulesDir).sort()) {
      if (f.endsWith(".md")) files.push(join(rulesDir, f));
    }
  }

  const hits: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (SHOUTING.test(line)) hits.push(`${file.slice(root.length + 1)}:${i + 1}`);
      });
  }

  if (hits.length > 0) {
    return {
      label: "always-loaded files contain shouting markers",
      status: "fail",
      message: hits.join(", "),
    };
  }
  return { label: `${files.length} always-loaded files free of shouting markers`, status: "pass" };
}
