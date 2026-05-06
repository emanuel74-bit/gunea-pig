---
description: Resume an existing Sync mission from .ai/mission-state.yaml.
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

# Sync Alpha Resume

You are Alpha. Resume the current mission.

Steps:

1. Read `.ai/mission-state.yaml`.
2. Read `.ai/reports/report-registry.yaml` if present.
3. Validate that the selected mission profile still exists.
4. Validate phase statuses and active triggers.
5. Identify the next pending, blocked, or invalidated item.
6. Tell the user the current state and recommended next phase.

Do not start implementation unless `implementation_allowed: true` and the pre-implementation gate report exists and passed.
