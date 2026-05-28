---
name: complete-mission
description: Finish a mission by collecting executor evidence, validating report evidence, and generating the final mission report.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Complete Mission


Use this skill when all phases have completed and transition artifacts are valid.

Run:
1. `npm --prefix conventions/scripts run executor -- --route collect_evidence`
2. `npm --prefix conventions/scripts run executor -- --route validate_report_evidence`
3. `npm --prefix conventions/scripts run executor -- --route generate_final_mission_report`

Final mission reports must be generated from script evidence. Do not manually write the final report as prose.

