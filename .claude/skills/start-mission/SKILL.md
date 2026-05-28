---
name: start-mission
description: Start an Autonomous Agent Activator mission with validated Claude execution planning and initial context generation.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Start Mission


Use this skill when the user starts a new mission.

Steps:
1. Run `npm --prefix conventions/scripts run executor -- --route generate_claude_execution_plan`.
2. Run `npm --prefix conventions/scripts run executor -- --route validate_claude_execution_plan`.
3. Run `npm --prefix conventions/scripts run executor -- --route validate_executor_routes`.
4. Run `npm --prefix conventions/scripts run executor -- --route validate_references`.
5. Generate the first phase bundle with `npm --prefix conventions/scripts run executor -- --route generate_phase_bundle`.
6. Validate it with `npm --prefix conventions/scripts run executor -- --route validate_phase_bundle`.
7. Continue only from the validated phase bundle.

Do not inspect the full convention package unless a route result or bundle requires it.

