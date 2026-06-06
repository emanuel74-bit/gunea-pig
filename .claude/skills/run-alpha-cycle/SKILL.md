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


Use this skill for every workflow cycle after mission start and after every transition.

Alpha responsibilities:

1. Run `npm --prefix conventions/scripts run executor -- --route inspect_mission_state --mission-id <mission_id>`.
2. Read the validated phase bundle and active phase plan.
3. Identify `owner_agent` from the bundle/agent phase ownership records.
4. Use `activate-agent` to delegate to the matching Claude subagent.
5. Ensure the agent works only inside the bundle authority.
6. After agent output, invoke `validate-phase`.
7. After validation passes, invoke `transition-phase`.

Alpha must not perform phase-agent work, manually approve gates, manually author handoffs, manually create revision decisions, or manually write final reports.

