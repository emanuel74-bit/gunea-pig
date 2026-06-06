# /start-mission

Use the `start-mission` skill to start the Autonomous Agent Activator mission.

The skill must require an explicit mission id, initialize mission state through `initialize_mission --mission-id <mission_id>`, inspect it through `inspect_mission_state --mission-id <mission_id>`, compile the preferred runtime context through `compile_context_bundle --scope mission_control`, and then continue through executor-route-backed planning, integrity validation, bundle generation, and Alpha activation.

Use `.ai/context/compiled-context-bundle.yaml` as the preferred compact runtime context after compilation. Do not bypass executor routes, manually create mission state, infer the active phase, directly select native subagents, or treat compiled context as a replacement for validated phase bundles.
