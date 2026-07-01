"""Subgrafo debug (bug-fix team) — detectar → corrigir → verificar.

`triage` (detect determinístico) → `context_loader` → `agent_loop`/`legacy_core` (fix)
→ `type_check`↔`corrective` + `test_runner` (verify) → `delivery_gate` (verify + repair
loop, incl. build graceful) → relatório estruturado no deliver.
"""

WORKFLOW_ID = "debug"
STEPS = [
    "triage",
    "context_loader",
    "agent_loop",
    "legacy_core",
    "type_check",
    "test_runner",
]
