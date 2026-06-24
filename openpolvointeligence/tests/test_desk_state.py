"""Testes desk_state (M1 CORE-1)."""

from openpolvointeligence.graphs.desk_state import initial_desk_state, truncate_trace


def test_initial_desk_state_defaults():
    st = initial_desk_state(
        messages=[],
        workspace_path="/tmp/ws",
        desk_context={"mode": "agent"},
        model_provider="ollama",
    )
    assert st["iteration"] == 0
    assert st["max_iterations"] == 8
    assert st["workspace_path"] == "/tmp/ws"
    assert st["desk_context"]["mode"] == "agent"


def test_truncate_trace():
    long = [f"s{i}" for i in range(30)]
    out = truncate_trace(long, limit=10)
    assert len(out) == 10
    assert out[0] == "s20"
