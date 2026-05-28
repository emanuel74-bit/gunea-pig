# Autonomous Agent Activator — Claude Code Native Workflow

This project uses the Autonomous Agent Activator convention system. Claude Code should operate it as a native workflow engine, not as a folder to manually inspect.

## Non-negotiable runtime rules

- Alpha controls mission orchestration. Phase agents perform phase work only after Alpha activates them from a validated phase bundle.
- Do not call convention scripts directly. Use executor route IDs only:

  `npm --prefix conventions/scripts run executor -- --route <route_id>`

- Work from validated phase bundles. Do not load the full convention package as normal task context.
- Topologies are script-facing compiled truth. Agents normally consume bundles, route results, and specific convention slices.
- Handoff packets, gate results, revision tasks, evidence indexes, final mission reports, and topology outputs are script-produced only.
- Stop on failed route, failed validation, blocked gate, invalid handoff, invalid revision task, or invalid report evidence.

## Native workflow entrypoints

Use these Claude skills instead of improvising the workflow:

- `start-mission`: mission intake, system integrity, Claude execution plan, first phase bundle.
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
2. `run-alpha-cycle`
3. `activate-agent`
4. `run-phase`
5. `validate-phase`
6. `transition-phase`
7. Repeat 2-6 until no phases remain.
8. `complete-mission`

## Subsystem engagement rule

Use `claude-code/conventions.claude-subsystem-engagement.yaml` as the compact workflow map. It tells Claude which subsystem slices, agents, routes, and artifacts are relevant to each workflow lane.
