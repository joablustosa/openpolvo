"""Testes do mapa de exports shadcn e correcção determinística de imports."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.shadcn_scaffold_exports import (
    build_shadcn_import_heal_ops,
    rewrite_shadcn_imports,
    validate_shadcn_named_imports,
)


def test_validate_detects_label_from_input():
    content = 'import { Input, Label } from "@/components/ui/input"\n'
    errs = validate_shadcn_named_imports("src/components/ContactForm.tsx", content)
    assert errs
    assert any("Label" in e["message"] for e in errs)
    assert errs[0]["code"] == "shadcn_import"


def test_rewrite_splits_label_to_label_module():
    before = (
        'import { Input, Label } from "@/components/ui/input"\n\n'
        "export function ContactForm() { return null }\n"
    )
    after, changed = rewrite_shadcn_imports(before)
    assert changed is True
    assert 'from "@/components/ui/input"' in after
    assert 'from "@/components/ui/label"' in after
    assert "Input, Label" not in after


def test_build_heal_ops_fixes_contact_form():
    files = {
        "src/components/ContactForm.tsx": (
            'import { Input, Label } from "@/components/ui/input"\n\n'
            "export function ContactForm() {\n"
            '  return <Input id="x" />\n'
            "}\n"
        ),
    }
    ops = build_shadcn_import_heal_ops(files)
    assert ops
    fixed = ops[0]["content"]
    assert 'from "@/components/ui/label"' in fixed
