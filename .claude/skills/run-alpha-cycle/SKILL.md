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

1. Read the validated phase bundle and active phase plan.
2. Identify `owner_agent` from the bundle/agent phase ownership records.
3. Use `activate-agent` to delegate to the matching Claude subagent.
4. Ensure the agent works only inside the bundle authority.
5. After agent output, invoke `validate-phase`.
6. After validation passes, invoke `transition-phase`.

Alpha must not perform phase-agent work, manually approve gates, manually author handoffs, manually create revision decisions, or manually write final reports.

