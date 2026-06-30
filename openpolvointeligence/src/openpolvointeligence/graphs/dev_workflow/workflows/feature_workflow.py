"""Subgrafo feature — impacto + codegen incremental."""

WORKFLOW_ID = "feature"
STEPS = [
    "context_loader",
    "impact_analyzer",
    "agent_loop",
    "legacy_core",
    "type_check",
    "lint_fix",
    "test_runner",
    "git",
    "review",
]
