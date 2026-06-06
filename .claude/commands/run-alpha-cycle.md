# /run-alpha-cycle

Use the `run-alpha-cycle` skill with an explicit mission id to let Alpha inspect mission state, compile the preferred `mission_control` context bundle, read the active validated phase bundle, select/activate the next phase agent, and continue the route-backed workflow cycle.

Use `.ai/context/compiled-context-bundle.yaml` as compact workflow context when present, but do not bypass executor routes, validated phase bundles, or native subagents.

If this is the first cycle after an interruption, run `/resume-mission` first; do not continue from remembered state.

Before loading broad convention context, run `npm --prefix conventions/scripts run invoke:route -- --route compile_context_bundle --scope mission_control` and read `.ai/context/compiled-context-bundle.yaml` as preferred compact supporting context.
