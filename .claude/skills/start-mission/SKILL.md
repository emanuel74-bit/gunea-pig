---
name: start-mission
description: Start an Autonomous Agent Activator mission through Alpha, system integrity routes, Claude execution planning, and first phase bundle generation.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Start Mission


Use this skill when the user starts a new mission.

Run in order:

1. `npm --prefix conventions/scripts run executor -- --route validate_executor_routes`
2. `npm --prefix conventions/scripts run executor -- --route validate_references`
3. `npm --prefix conventions/scripts run executor -- --route validate_runtime_artifacts`
4. `npm --prefix conventions/scripts run executor -- --route validate_script_execution`
5. `npm --prefix conventions/scripts run executor -- --route generate_claude_execution_plan`
6. `npm --prefix conventions/scripts run executor -- --route validate_claude_execution_plan`
7. `npm --prefix conventions/scripts run executor -- --route generate_phase_bundle`
8. `npm --prefix conventions/scripts run executor -- --route validate_phase_bundle`

Then invoke `run-alpha-cycle`.

Do not select a phase agent manually before the validated phase bundle identifies the owner agent.

