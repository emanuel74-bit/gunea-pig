---
name: complete-mission
description: Finish a mission by collecting executor evidence, validating report evidence, and generating the final mission report.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Complete Mission


Use this skill only after all phases are complete and no blocking revision task remains.

Run:

1. `npm --prefix conventions/scripts run invoke:route -- --route inspect_mission_state --mission-id <mission_id>`
2. `npm --prefix conventions/scripts run invoke:route -- --route collect_evidence`
3. `npm --prefix conventions/scripts run invoke:route -- --route validate_report_evidence`
4. `npm --prefix conventions/scripts run invoke:route -- --route generate_final_mission_report`

The final mission report is script-produced only. Do not manually write it as prose.

