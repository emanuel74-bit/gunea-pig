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

1. `npm --prefix conventions/scripts run invoke:route -- --route validate_executor_routes`
2. `npm --prefix conventions/scripts run invoke:route -- --route initialize_mission --mission-id <mission_id>`
3. `npm --prefix conventions/scripts run invoke:route -- --route inspect_mission_state --mission-id <mission_id>`
4. `npm --prefix conventions/scripts run invoke:route -- --route compile_context_bundle --scope mission_control`
5. Read `.ai/context/compiled-context-bundle.yaml` as preferred compact mission-control context when present.
6. `npm --prefix conventions/scripts run invoke:route -- --route validate_references`
7. `npm --prefix conventions/scripts run invoke:route -- --route validate_runtime_artifacts`
8. `npm --prefix conventions/scripts run invoke:route -- --route validate_script_execution`
9. `npm --prefix conventions/scripts run invoke:route -- --route generate_claude_execution_plan`
10. `npm --prefix conventions/scripts run invoke:route -- --route validate_claude_execution_plan`
11. `npm --prefix conventions/scripts run invoke:route -- --route generate_mission_bundle`
12. `npm --prefix conventions/scripts run invoke:route -- --route compile_context_bundle --scope planning_scope_and_evidence`
13. Read `.ai/context/compiled-context-bundle.yaml` as preferred planning/evidence context.
14. `npm --prefix conventions/scripts run invoke:route -- --route generate_phase_bundle`
15. `npm --prefix conventions/scripts run invoke:route -- --route validate_phase_bundle`

Then invoke `run-alpha-cycle`.

The mission controller requires an explicit `<mission_id>`, initializes and observes state only in this phase. Compiled context bundles are preferred compact runtime context, not authority to skip routes or phase bundles. Do not manually create mission state, choose a phase, or infer advancement outside executor routes.

Do not select a phase agent manually before the validated phase bundle identifies the owner agent.

