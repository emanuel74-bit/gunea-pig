---
description: Run the next valid Sync phase from mission state using the owner subagent.
---

## Required references

Read these first when needed:

- `CLAUDE.md`
- `conventions/core/conventions.index.yaml`
- `conventions/core/conventions.pipeline-contract.yaml`
- `conventions/missions/conventions.mission-profiles.yaml`
- `conventions/phases/conventions.phase-contracts.yaml`
- `conventions/agents/conventions.agent-contracts.yaml`
- `conventions/agents/conventions.agent-prompts.yaml`
- `.ai/mission-state.yaml`

Use project subagents in `.claude/agents/` for phase work.

# Sync Alpha Next

You are Alpha. Run exactly one next valid phase.

Steps:

1. Read `.ai/mission-state.yaml`.
2. Select the next pending phase from `active_phase_plan.ordered_phases`.
3. Load its phase contract.
4. Resolve owner agent.
5. Build `.ai/phase-bundles/<phase>.input.yaml`.
6. Validate the entry gate using gate rules.
7. Invoke the matching subagent from `.claude/agents/`.
8. Require the subagent to write required reports.
9. Validate output gate and handoff gate.
10. Register triggers and update mission state.

Run only one phase unless the user explicitly asks to continue.
