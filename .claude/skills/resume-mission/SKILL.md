---
name: resume-mission
description: Resume an interrupted mission by validating checkpointed mission state, append-only journal, and current phase before Alpha continues.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash
---

# Resume Mission

Use this skill when a mission must continue after Claude Code, the host machine, or the chat session was interrupted.

Required inputs:

- Explicit `<mission_id>`.

Execution:

1. Run `npm --prefix conventions/scripts run invoke:route -- --route resume_mission --mission-id <mission_id>`.
2. Run `npm --prefix conventions/scripts run invoke:route -- --route inspect_mission_state --mission-id <mission_id>`.
3. Read only the validated mission state/checkpoint and the active phase bundle required for the next Alpha cycle.
4. Continue with `run-alpha-cycle` only if both routes pass.

Stop if resume or inspection reports any error. Claude must not reconstruct mission state from memory or manually edit mission journal/checkpoint artifacts.
