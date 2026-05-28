# Claude Code Hooks

Project hooks are configured in `.claude/settings.json`.

All hooks must use the executor route wrapper:

`npm --prefix conventions/scripts run executor -- --route <route_id>`

Hooks must not call `conventions/scripts/*.ts` directly. The route wrapper resolves the central executor map and keeps script invocation aligned with the convention system.
