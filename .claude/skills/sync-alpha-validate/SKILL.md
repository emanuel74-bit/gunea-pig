---
description: Validate the Sync convention package, mission state, reports, gates, and required outputs.
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

# Sync Alpha Validate

Run validation without performing phase work.

Recommended command:

```bash
python3 scripts/sync_validate_package.py
```

Then validate:

1. YAML parse status.
2. File-contract top-level schema.
3. Phase coverage.
4. Agent coverage.
5. Mission profile references.
6. Report registry references.
7. Gate/trigger/handoff/revision references.
8. `.ai/mission-state.yaml` consistency.

Write a validation summary to `.ai/reports/validation-run.yaml` when useful.
