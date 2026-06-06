# /start-mission

Use the `start-mission` skill to start the Autonomous Agent Activator mission.

The skill must initialize mission state through `initialize_mission`, inspect it through `inspect_mission_state`, and then continue through executor-route-backed planning, integrity validation, bundle generation, and Alpha activation.

Do not bypass executor routes, manually create mission state, infer the active phase, or directly select native subagents.
