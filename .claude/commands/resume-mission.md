# /resume-mission

Use the `resume-mission` skill with an explicit mission id after an interrupted Claude Code session or machine shutdown.

The skill must validate and resume authoritative mission state through `resume_mission --mission-id <mission_id>`, then inspect it through `inspect_mission_state --mission-id <mission_id>` before any Alpha cycle continues.

Do not infer phase state from memory, chat history, or narrative notes.
