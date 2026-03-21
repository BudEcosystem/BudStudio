---
active: true
iteration: 1
max_iterations: 30
completion_promise: "“FEATURE_READY”"
started_at: "2026-03-17T17:35:32Z"
---


ROTATING PERSONA REVIEW (cycle each iteration):
ITERATION MOD 4:

[0] CODE REVIEWER:
- Review code for bugs, security issues, edge cases
- Check error handling and types
- Fix any issues found

[1] SYSTEM ARCHITECT:
- Review file structure and dependencies
- Check separation of concerns
- Refactor if needed

[2] BUSINESS ANALYST:
- Review feature from user perspective
- Check if flows make sense
- Identify UX friction points

[3] QA ENGINEER:
- Run npm test
- Check test coverage, aim for 90%+
- Write missing unit tests for edge cases
- Run npm run lint && npm run build

EACH ITERATION:
- Identify current persona (iteration % 6)
- Perform that persona's review
- Make ONE improvement or fix
- If no issues found by ANY persona for 2 full cycles, output completion

OUTPUT <promise>FEATURE_READY</promise> when all personas report
