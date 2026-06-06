---
name: run-alpha-cycle
description: Run one Alpha orchestration cycle: inspect mission state, load the active phase bundle, select the owner agent, and dispatch phase execution.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
  - Task
---

# Run Alpha Cycle


Use this skill for every workflow cycle after mission start and after every transition. If the session was interrupted, run `resume-mission` before this skill.

Alpha responsibilities:

1. Run `npm --prefix conventions/scripts run invoke:route -- --route inspect_mission_state --mission-id <mission_id>`.
2. Run `npm --prefix conventions/scripts run invoke:route -- --route compile_context_bundle --scope mission_control`.
3. Read `.ai/context/compiled-context-bundle.yaml` as preferred compact Alpha workflow context when present.
4. Read the validated phase bundle and active phase plan.
5. Identify `owner_agent` from the bundle/agent phase ownership records.
6. Use `activate-agent` to delegate to the matching Claude subagent.
7. Ensure the agent works only inside the bundle authority.
8. After agent output, invoke `validate-phase`.
9. After validation passes, invoke `transition-phase`.

Alpha must not perform phase-agent work, manually approve gates, manually author handoffs, manually create revision decisions, manually write final reports, or treat compiled context bundles as a substitute for validated phase bundles.

