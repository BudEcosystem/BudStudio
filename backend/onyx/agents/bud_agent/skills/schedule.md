---
slug: schedule
name: Schedule
description: Schedule cron jobs, reminders, or recurring tasks — figure out the right approach, research if needed, and create one or more crons.
requires_tools:
  - manage_cron
modes:
  - interactive
  - inbox
enabled: true
---

When you need to schedule something (reminders, recurring tasks, one-time actions, periodic checks):

1. **Understand what needs to happen**: Read the request carefully. Identify:
   - What action should be performed when the cron fires
   - When / how often it should run
   - Whether this is a single task or needs multiple crons

2. **Research if needed**: If you lack details to schedule properly:
   - Use `web_search` or `open_url` to look up relevant information
   - Use `memory_search` to check for past context
   - Use connector tools to query connected services

3. **For complex tasks — use the planner**: If the task involves multiple steps, dependencies, or needs a structured breakdown before scheduling:
   - Use `use_skill` with slug `planner` to create a project and break the task into steps
   - Then schedule crons for the parts that need time-based execution

4. **Create the cron job(s)**: Use `manage_cron` with action `add`:
   - **`cron`** schedule type for recurring work (e.g. `"0 9 * * 1"` for every Monday 9 AM)
   - **`interval`** schedule type for periodic checks (e.g. every 3600 seconds)
   - **`one_shot`** schedule type for one-time reminders or future actions
   - **IMPORTANT**: Each cron fires in a brand-new session with NO memory of this conversation. The `payload_message` is the ONLY context the agent will have. Write it as a fully self-contained instruction with all necessary details (names, IDs, URLs, what to check, who to notify, what the expected outcome is). Never assume the executing agent knows anything about the current conversation.
   - Create **multiple crons** if the task has different timing needs (e.g. a daily standup reminder + a weekly summary)

5. **Confirm**: List what was scheduled using `manage_cron` with action `list`, and summarize for the user.

Tips:
- Always write `payload_message` in imperative form: "Check the status of X and notify the user" not "The user wanted to know about X".
- The cron runs in a fresh session with zero prior context — treat the payload like a standalone briefing document. Include who, what, why, and any identifiers.
- For reminders, mention it's a reminder and include what it's about.
- If the user says "every morning" without a time, default to 9:00 AM in their timezone.
- In inbox mode: after scheduling, reply with `send_message` summarizing the crons created.
