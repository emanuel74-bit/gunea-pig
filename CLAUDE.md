# Autonomous Agent Activator — Claude Code Native Workflow

This project uses the Autonomous Agent Activator convention system. Claude Code should operate it as a native workflow engine, not as a folder to manually inspect.

## Non-negotiable runtime rules

- Alpha controls mission orchestration. Phase agents perform phase work only after Alpha activates them from a validated phase bundle.
- Do not call convention scripts directly. Use executor route IDs only:

  `npm --prefix conventions/scripts run invoke:route -- --route <route_id>`

- Work from validated phase bundles. Do not load the full convention package as normal task context.
- Topologies are script-facing compiled truth. Agents normally consume bundles, route results, and specific convention slices.
- Handoff packets, gate results, revision tasks, evidence indexes, final mission reports, and topology outputs are script-produced only.
- Stop on failed route, failed validation, blocked gate, invalid handoff, invalid revision task, or invalid report evidence.

## Native workflow entrypoints

Use these Claude skills instead of improvising the workflow:

- `start-mission`: mission intake, system integrity, Claude execution plan, first phase bundle.
- `resume-mission`: recover from interruption using checkpointed mission state, append-only journal validation, and route-backed inspection.
- `run-alpha-cycle`: Alpha selects/activates the next phase agent and controls lifecycle routing.
- `activate-agent`: activate the correct Claude subagent from the phase bundle owner agent.
- `run-phase`: execute phase work from the validated bundle.
- `validate-phase`: validate changed files, phase output, semantic completeness, reports/evidence.
- `transition-phase`: gate, handoff, revision fallback, and next-phase readiness.
- `revision-loop`: consume script-produced revision task and revalidate.
- `generate-artifact`: generate only route-backed artifacts.
- `collect-report-evidence`: collect/validate report evidence before completion or handoff.
- `complete-mission`: collect evidence, validate report evidence, generate final mission report.

## Standard mission ladder

1. `start-mission`
2. `resume-mission` only after interruption or session restart
3. `run-alpha-cycle`
4. `activate-agent`
5. `run-phase`
6. `validate-phase`
7. `transition-phase`
8. Repeat 3-7 until no phases remain.
9. `complete-mission`

## Subsystem engagement rule

Use `claude-code/conventions.claude-subsystem-engagement.yaml` as the compact workflow map. It tells Claude which subsystem slices, agents, routes, and artifacts are relevant to each workflow lane.
## Compiled Context Bundles

When a workflow lane is active, prefer `npm --prefix conventions/scripts run invoke:route -- --route compile_context_bundle --scope <scope>` before loading broad convention context. Read `.ai/context/compiled-context-bundle.yaml` and `.ai/context/context-load-trace.yaml` as compact supporting context. Compiled context never replaces executor routes, mission state, or validated phase bundles.

