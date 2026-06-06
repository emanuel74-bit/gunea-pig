# /run-alpha-cycle

Use the `run-alpha-cycle` skill with an explicit mission id to let Alpha inspect mission state, compile the preferred `mission_control` context bundle, read the active validated phase bundle, select/activate the next phase agent, and continue the route-backed workflow cycle.

Use `.ai/context/compiled-context-bundle.yaml` as compact workflow context when present, but do not bypass executor routes, validated phase bundles, or native subagents.

If this is the first cycle after an interruption, run `/resume-mission` first; do not continue from remembered state.
