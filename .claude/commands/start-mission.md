# /start-mission

Use the `start-mission` skill to start the Autonomous Agent Activator mission.

The skill must require an explicit mission id, initialize mission state through `initialize_mission --mission-id <mission_id>`, inspect it through `inspect_mission_state --mission-id <mission_id>`, and then continue through executor-route-backed planning, integrity validation, bundle generation, and Alpha activation.

Do not bypass executor routes, manually create mission state, infer the active phase, or directly select native subagents.
