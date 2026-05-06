# Sync Alpha Workflow Instructions for Claude Code

You are operating inside a repository that uses the Sync Convention System.

## Source of truth

The convention system lives in `conventions/`. Do not invent local rules when a convention file exists.

Start with these files when workflow control is needed:

- `conventions/core/conventions.file-contract.yaml`
- `conventions/core/conventions.index.yaml`
- `conventions/core/conventions.pipeline-contract.yaml`
- `conventions/missions/conventions.mission-profiles.yaml`
- `conventions/missions/conventions.mission-state.yaml`
- `conventions/phases/conventions.phase-taxonomy.yaml`
- `conventions/phases/conventions.phase-contracts.yaml`
- `conventions/agents/conventions.agent-taxonomy.yaml`
- `conventions/agents/conventions.agent-contracts.yaml`
- `conventions/agents/conventions.agent-permissions.yaml`
- `conventions/agents/conventions.agent-prompts.yaml`

## Non-negotiable runtime model

Alpha controls the workflow. Phase agents do phase work only.

```text
Agents do work.
Reports carry work.
Gates validate work.
Triggers request more work.
Handoffs connect work.
Revisions correct work.
Alpha controls runtime.
Mission state records truth.
```

## When the user asks for a code change, design, refactor, bugfix, test work, or convention-system edit

Do not jump directly into coding. Use the Alpha workflow:

1. Select a mission profile.
2. Initialize or update `.ai/mission-state.yaml`.
3. Create the active context manifest.
4. Execute phases in the active phase plan.
5. For each phase, use the owner agent from `conventions/phases/conventions.phase-contracts.yaml`.
6. Require file-backed reports in `.ai/reports/`.
7. Validate gates before moving forward.
8. Do not implement until `pre_implementation_gate` passes.
9. Do not mark final validation passed if reports, gates, triggers, blockers, invalidations, or required phase statuses are unresolved.

## Claude Code usage

Prefer the provided skills:

- `/sync-alpha-start` — start a mission from a user request.
- `/sync-alpha-next` — run the next valid phase.
- `/sync-alpha-run-phase` — run a specific phase.
- `/sync-alpha-validate` — validate package/state/reports.
- `/sync-alpha-resume` — resume an existing mission.

## Subagent usage

Use the matching project subagent from `.claude/agents/` for phase work. The subagent name uses hyphens, while the internal convention `agent_id` uses underscores.

Examples:

- `behavior_agent` -> `behavior-agent`
- `artifact_action_agent` -> `artifact-action-agent`
- `pre_implementation_gate_agent` -> `pre-implementation-gate-agent`

Before invoking a subagent, build a phase input bundle under `.ai/phase-bundles/` using the phase contract.

## Output rules

Required phase outputs must be written to files. Console-only responses do not satisfy the convention system.

Never rewrite prior phase reports to make a later phase pass. Use triggers, revision requests, invalidation, rerun, or final unresolved items.
