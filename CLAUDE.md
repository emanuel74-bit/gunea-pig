# Autonomous Agent Activator — Claude Code Project Rules

Use the Autonomous Agent Activator system for code missions in this project.

## Always-on rules

- Do not call convention scripts directly.
- Invoke automation only through executor routes using:

  `npm --prefix conventions/scripts run executor -- --route <route_id>`

- Start mission work by generating and validating a Claude execution plan.
- Work from a validated phase bundle, not from the full convention package.
- Treat topologies as script-facing compiled truth, not normal agent context.
- Stop on failed validation, failed gate result, invalid handoff, or invalid revision task.
- Handoff packets, gate results, revision tasks, final reports, and evidence summaries are script-produced artifacts only.
- Alpha orchestrates executor routes and consumes validated results; Alpha does not manually approve, reject, author, or override transition decisions.

## Standard route sequence

Before mission work:

`npm --prefix conventions/scripts run executor -- --route generate_claude_execution_plan`
`npm --prefix conventions/scripts run executor -- --route validate_claude_execution_plan`
`npm --prefix conventions/scripts run executor -- --route validate_executor_routes`
`npm --prefix conventions/scripts run executor -- --route validate_references`

Before phase work:

`npm --prefix conventions/scripts run executor -- --route generate_phase_bundle`
`npm --prefix conventions/scripts run executor -- --route validate_phase_bundle`

After edits:

`npm --prefix conventions/scripts run executor -- --route validate_changed_files`

Before mission completion:

`npm --prefix conventions/scripts run executor -- --route collect_evidence`
`npm --prefix conventions/scripts run executor -- --route validate_report_evidence`
`npm --prefix conventions/scripts run executor -- --route generate_final_mission_report`
