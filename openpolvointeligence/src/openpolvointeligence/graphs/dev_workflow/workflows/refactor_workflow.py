"""Subgrafo refactor — refatoração incremental."""

WORKFLOW_ID = "refactor"
STEPS = [
    "context_loader",
    "agent_loop",
    "legacy_core",
    "type_check",
    "lint_fix",
    "test_runner",
    "git",
    "review",
]
