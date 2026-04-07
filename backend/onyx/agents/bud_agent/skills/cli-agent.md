---
slug: cli_agent
name: CLI Agent
description: Delegate complex tasks to an autonomous sub-agent that can do anything achievable from a command line. Use this skill whenever the task benefits from autonomous exploration and multi-step reasoning — code analysis, system administration, data processing, file organization, research across files, infrastructure setup, log analysis, environment configuration, and more. If the task would take you 3+ sequential tool calls to figure out, delegate it to cli_agent instead.
requires_tools:
  - cli_agent
modes:
  - interactive
enabled: true
---

When the user's request is complex enough to benefit from autonomous exploration, delegate it to `cli_agent` rather than attempting it manually with bash/grep/read_file. The sub-agent is a general-purpose CLI agent — anything you can do from a terminal, it can do autonomously.

## When to use cli_agent

Use it when the task involves any of these:
- **Code work**: dead code detection, refactoring, debugging, scaffolding, code review, architecture analysis, dependency audits
- **System administration**: configuring services, managing processes, setting up environments, troubleshooting system issues, checking disk/memory/network
- **Data processing**: parsing logs, transforming CSVs, aggregating data across files, cleaning datasets, format conversion
- **File operations**: organizing directories, bulk renaming, finding duplicates, migrating file structures, archiving
- **Infrastructure**: Docker/container setup, CI/CD pipeline configuration, deployment scripts, environment provisioning
- **Research & investigation**: tracing how something works across files, analyzing logs for patterns, auditing configurations, understanding unfamiliar systems
- **Automation**: writing and testing scripts, building pipelines, setting up cron jobs, creating Makefiles

The key signal is: if the task requires exploration, reasoning, and multiple steps before producing an answer — delegate it. The sub-agent can read files, run commands, write scripts, and iterate until the task is done.

## How to call cli_agent

1. **Write a clear, detailed prompt.** The sub-agent has no context from this conversation. Include:
   - What to do (the task)
   - Where to look (specific directories, files, or systems)
   - What output you expect (a summary, a list of findings, modified files, a script, etc.)
   - Any constraints (don't modify files, stay within a directory, etc.)

2. **Choose the right sandbox level:**
   - `read-only` — for analysis, investigation, and research tasks. Safest choice when no writes are needed.
   - `workspace-write` (default) — for tasks that create or modify files within the workspace.
   - `danger-full-access` — when the task requires network access, installing packages, running services, or writing outside the workspace.

3. **Set working_directory** if the task targets a specific subdirectory or project.

4. **Set skip_git_check to true** if the target directory isn't a git repo (e.g., temp directories, system paths, downloaded archives).

## Example prompts

**Code analysis:**
```
cli_agent(
  prompt: "Find all dead code in this project: unused functions, unreachable branches, unused imports. List each finding with file path, line number, and why it's dead.",
  sandbox: "read-only"
)
```

**Log analysis:**
```
cli_agent(
  prompt: "Analyze the last 24 hours of nginx access logs in /var/log/nginx/. Find the top 10 IPs by request count, any 5xx error patterns, and the slowest endpoints. Produce a summary report.",
  sandbox: "read-only",
  skip_git_check: true,
  working_directory: "/var/log/nginx"
)
```

**System investigation:**
```
cli_agent(
  prompt: "This server is running slow. Check CPU, memory, disk usage, running processes, and network connections. Identify the top resource consumers and any anomalies. Suggest fixes.",
  sandbox: "read-only",
  skip_git_check: true
)
```

**Data processing:**
```
cli_agent(
  prompt: "There are 50+ CSV files in the data/ directory with inconsistent column names and formats. Normalize them all to have the same headers, clean up date formats to ISO 8601, and merge into a single output.csv.",
  sandbox: "workspace-write"
)
```

**Infrastructure setup:**
```
cli_agent(
  prompt: "Set up a Docker Compose configuration for this Node.js app with PostgreSQL and Redis. Include health checks, volume mounts for data persistence, and a .env.example file.",
  sandbox: "workspace-write"
)
```

## Resume vs Exec — choosing the right action

**Always prefer `action: "resume"` when the user's message is a follow-up to a previous cli_agent task.** Resume continues the most recent BudCode session, which already has the full context of what was done — files explored, commands run, results found. Starting a fresh `exec` loses all of that context and wastes time re-exploring.

**Use `resume` when:**
- The user asks a follow-up question about the previous result (e.g., "what's in /Applications?" after a disk usage scan)
- The user wants to drill deeper into something the agent already found
- The agent asked a clarifying question and the user has answered
- The user says "also check...", "now do...", "what about..."
- The task is a continuation of the same topic/investigation

**Use `exec` only when:**
- It's a completely new, unrelated task
- The user explicitly wants a fresh start

```
cli_agent(
  action: "resume",
  prompt: "Now drill into the /Applications folder and show me each app with its size, sorted largest first."
)
```

## After calling cli_agent

- **Do NOT poll** with the process tool. Results are returned automatically when the agent completes.
- **Inform the user** that the task is running: "I've started a sub-agent to [task]. I'll have the results shortly."
- **When results arrive**, summarize them concisely. Highlight key findings and suggest next steps if appropriate.
- If the agent asked a question or needs input, present it to the user and use `action: "resume"` with their answer.
- If the task failed or was terminated, explain what happened and offer to retry with adjusted parameters.

## Tips

- For any task where you only need to read and analyze, use `sandbox: "read-only"` — it prevents accidental modifications.
- Write prompts as if briefing a colleague who has zero context. Include all relevant details.
- For large workspaces, narrow the scope with `working_directory` or mention specific paths in the prompt.
- The sub-agent is great at tasks you'd normally do in a terminal: grep through logs, write a quick script, parse some data, check system health, explore a codebase. If it can be done from a CLI, delegate it.
