---
slug: planner
name: Planner
description: Break down a goal or larger activity into structured tasks, dependencies, and progress tracking.
requires_tools:
  - taskgraph_project_create
  - taskgraph_task_create
modes:
  - interactive
enabled: true
---

When the user asks you to plan something, create a roadmap, or break down a goal:

1. **Clarify the goal**: Understand the goal reallly deep. If the request is vague, ask 1-2 focused questions to understand scope, timeline, and constraints. Don't over-ask — start planning once you have enough context.

2. **Create a taskgraph project**: Use `taskgraph_project_create` to create a project for the plan.

3. **Break into tasks**: Once you have the full context, breakdown the goal to relevant task and Use `taskgraph_task_create` or `taskgraph_task_create_batch` to save tasks with:
   - Clear, actionable titles
   - Dependencies between tasks where order matters
   - Descriptions with acceptance criteria or notes

4. **Show the plan**: After creating tasks, use `taskgraph_project_status` or `taskgraph_status` to show the user the full plan with task states.

5. **Execute when asked**: When the user wants to start working through the plan:
   - Use `taskgraph_go` to get and start the next ready task
   - Help the user complete it
   - Use `taskgraph_task_done` to mark it complete
   - Continue to the next task

6. **Adapt the plan**: If priorities change:
   - `taskgraph_task_update` to modify a task
   - `taskgraph_task_insert` to add a task between existing ones
   - `taskgraph_task_decompose` to break a large task into subtasks
   - `taskgraph_task_replan` to replace remaining subtasks with new ones

Tips:
- Keep tasks small and actionable — each should be completable in one step.
- Use dependencies to encode ordering, not numbering.
- For large goals, create phases as parent tasks with subtasks via `taskgraph_task_decompose`.
- Use `taskgraph_task_note` to attach context or decisions to specific tasks.
- Offer to set reminders for key milestones using `manage_cron`.
