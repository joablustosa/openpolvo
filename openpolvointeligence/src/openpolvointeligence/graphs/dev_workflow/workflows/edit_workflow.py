"""Subgrafo edit — edição cirúrgica."""

WORKFLOW_ID = "edit"
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
