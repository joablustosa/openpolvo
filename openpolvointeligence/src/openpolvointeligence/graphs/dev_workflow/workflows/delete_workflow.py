"""Subgrafo delete — remoção segura."""

WORKFLOW_ID = "delete"
PAUSE_BEFORE = True
STEPS = [
    "context_loader",
    "impact_analyzer",
    "delete",
    "type_check",
]
