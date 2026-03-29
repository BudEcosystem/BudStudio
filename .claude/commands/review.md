---
description: "Run rotating persona code review (Code Reviewer, System Architect, Business Analyst, QA Engineer)"
argument-hint: "[--max-iterations N]"
---

# Rotating Persona Review

Run the Ralph Wiggum loop with a 4-persona rotating review cycle. Each iteration assumes a different persona and reviews the current code changes. The loop exits when all personas report no issues for 2 full cycles.

**Personas:**
- **Code Reviewer** (iteration 0, 4, 8...): bugs, security, edge cases, error handling
- **System Architect** (iteration 1, 5, 9...): file structure, dependencies, separation of concerns
- **Business Analyst** (iteration 2, 6, 10...): user perspective, flow correctness, UX friction
- **QA Engineer** (iteration 3, 7, 11...): run tests, check coverage, lint, build

Use `/ralph-wiggum:ralph-loop` with the following prompt:

```
/ralph-wiggum:ralph-loop ROTATING PERSONA REVIEW - cycle each iteration. ITERATION MOD 4 -- 0 CODE REVIEWER: Review code for bugs, security issues, edge cases. Check error handling and types. Fix any issues found. 1 SYSTEM ARCHITECT: Review file structure and dependencies. Check separation of concerns. Refactor if needed. 2 BUSINESS ANALYST: Review feature from user perspective. Check if flows make sense. Identify UX friction points. 3 QA ENGINEER: Run tests with pytest. Check test coverage. Write missing unit tests for edge cases. Run linting and build. EACH ITERATION: Identify current persona via iteration mod 4. Perform that personas review. Make ONE improvement or fix. If no issues found by ANY persona for 2 full cycles, output completion. --completion-promise FEATURE_READY $ARGUMENTS
```