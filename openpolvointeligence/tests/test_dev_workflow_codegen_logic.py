"""Testes Code_Generator — patches estruturados."""

from openpolvointeligence.graphs.dev_workflow_codegen_logic import (
    apply_structured_patch,
    build_codegen_file_excerpts,
    resolve_codegen_operations,
)

SAMPLE = """import React from 'react';

export function ContractsPage() {
  return (
    <div>
      <Button className="btn-export bg-blue-600">Exportar PDF</Button>
    </div>
  );
}
"""


def test_apply_structured_patch_button_color():
    patch = {
        "start_line": 6,
        "end_line": 6,
        "old_text": 'className="btn-export bg-blue-600"',
        "new_text": 'className="btn-export bg-emerald-600"',
    }
    out, err = apply_structured_patch(SAMPLE, patch)
    assert err is None
    assert out is not None
    assert "emerald" in out
    assert "blue-600" not in out


def test_reject_write_large_existing_file():
    big = "\n".join([f"line {i}" for i in range(200)])
    ops = [{"op": "write", "path": "src/pages/Big.tsx", "content": big}]
    files = {"src/pages/Big.tsx": big}
    plan = {"files_to_modify": ["src/pages/Big.tsx"], "files_to_create": []}
    resolved, errs = resolve_codegen_operations(ops, files, plan)
    assert len(resolved) == 0
    assert any("patch" in e.lower() or "rejeitado" in e.lower() for e in errs)


def test_resolve_patch_to_write():
    ops = [
        {
            "op": "patch",
            "path": "src/pages/ContractsPage.tsx",
            "patches": [
                {
                    "start_line": 6,
                    "end_line": 6,
                    "old_text": 'className="btn-export bg-blue-600"',
                    "new_text": 'className="btn-export bg-emerald-600"',
                },
            ],
        },
    ]
    files = {"src/pages/ContractsPage.tsx": SAMPLE}
    plan = {
        "files_to_modify": ["src/pages/ContractsPage.tsx"],
        "files_to_create": [],
    }
    resolved, errs = resolve_codegen_operations(ops, files, plan)
    assert not errs or len(resolved) == 1
    assert len(resolved) == 1
    assert resolved[0]["op"] == "write"
    assert "emerald" in resolved[0]["content"]


def test_build_excerpts_has_line_numbers():
    plan = {"files_to_modify": ["src/pages/ContractsPage.tsx"]}
    block = build_codegen_file_excerpts(plan, {"src/pages/ContractsPage.tsx": SAMPLE})
    assert "   6|" in block
    assert "blue-600" in block


def test_patch_allowed_on_existing_file_outside_plan_when_in_project():
    ops = [
        {
            "op": "patch",
            "path": "src/components/Hero.tsx",
            "patches": [
                {
                    "start_line": 1,
                    "end_line": 1,
                    "old_text": "import React from 'react';",
                    "new_text": "import React from 'react';\n// fix",
                },
            ],
        },
    ]
    files = {"src/components/Hero.tsx": "import React from 'react';\n"}
    plan = {"files_to_modify": ["src/pages/Other.tsx"], "files_to_create": []}
    resolved, errs = resolve_codegen_operations(ops, files, plan)
    assert len(resolved) == 1
    assert not errs
