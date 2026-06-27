"""Testes do virtual build estático."""

from __future__ import annotations

from openpolvointeligence.graphs.dev_workflow.dev_workflow_static_verify import run_static_verify


def test_static_verify_allows_router_with_import():
    files = {
        "src/App.tsx": (
            'import { Route, Routes } from "react-router-dom"\n'
            'import LandingPage from "@/pages/LandingPage"\n'
            "export default function App() {\n"
            '  return <Routes><Route path="/" element={<LandingPage />} /></Routes>;\n'
            "}\n"
        ),
        "src/pages/LandingPage.tsx": "export default function LandingPage(){return null}\n",
    }
    result = run_static_verify(files)
    assert result["ok"] is True


def test_static_verify_detects_missing_page_import():
    files = {
        "src/App.tsx": (
            'import LandingPage from "@/pages/LandingPage"\n'
            "export default function App() { return <LandingPage />; }\n"
        ),
    }
    result = run_static_verify(files)
    assert result["ok"] is False
    assert any("LandingPage" in e for e in result["errors"])


def test_static_verify_ok_clean_project():
    files = {
        "src/App.tsx": (
            'import { Navigate, Route, Routes } from "react-router-dom"\n'
            'import AppShell from "@/components/layout/AppShell"\n'
            'import LandingPage from "@/pages/LandingPage"\n'
            "export default function App() {\n"
            "  return (\n"
            "    <AppShell>\n"
            "      <Routes>\n"
            '        <Route path="/" element={<LandingPage />} />\n'
            '        <Route path="*" element={<Navigate to="/" replace />} />\n'
            "      </Routes>\n"
            "    </AppShell>\n"
            "  );\n"
            "}\n"
        ),
        "src/pages/LandingPage.tsx": "export default function LandingPage(){return null}\n",
    }
    result = run_static_verify(files)
    assert result["ok"] is True


def test_static_verify_detects_wrong_shadcn_import():
    files = {
        "src/components/ContactForm.tsx": (
            'import { Input, Label } from "@/components/ui/input"\n'
            "export function ContactForm(){return null}\n"
        ),
    }
    result = run_static_verify(files)
    assert result["ok"] is False
    assert any("Label" in e for e in result["errors"])


def test_static_verify_server_paths():
    files = {
        "server/index.ts": 'import { Hono } from "hono";\nexport const app = new Hono();\n',
        "server/db/schema.ts": 'import { pgTable, serial, text } from "drizzle-orm/pg-core";\n',
    }
    result = run_static_verify(files)
    assert result["ok"] is True
