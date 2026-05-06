---
description: Run a specific Sync phase by name using the phase contract and owner subagent.
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

# Sync Alpha Run Phase

User will provide a phase id or describe the phase.

Steps:

1. Resolve the phase id from `conventions/phases/conventions.phase-taxonomy.yaml`.
2. Load the phase contract.
3. Verify the phase is active, conditional with a valid trigger, or explicitly requested.
4. Build `.ai/phase-bundles/<phase>.input.yaml`.
5. Run entry gate.
6. Invoke the owner subagent.
7. Validate required outputs.
8. Register triggers and update mission state.

Do not run unrelated phases.
