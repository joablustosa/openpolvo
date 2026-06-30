"""Subgrafo new_app — scaffold + agentes especializados."""

WORKFLOW_ID = "new_app"
STEPS = [
    "context_loader",
    "requirements",
    "stack_selector",
    "legacy_core",
    "type_check",
    "lint_fix",
    "test_runner",
    "dependency",
    "migration",
    "git",
    "workspace_opener",
    "review",
]
