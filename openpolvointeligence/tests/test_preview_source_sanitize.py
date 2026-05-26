from openpolvointeligence.graphs.preview_source_sanitize import (
    preview_source_has_forbidden_imports,
    sanitize_preview_tsx,
)


def test_sanitize_removes_react_router_import():
    raw = '''import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"

export default function Navbar() {
  return <Link to="/">Home</Link>
}
'''
    out = sanitize_preview_tsx(raw, "src/components/layout/Navbar.tsx")
    assert "react-router-dom" not in out
    assert "<a" in out
    assert "href=" in out


def test_forbidden_detected():
    assert preview_source_has_forbidden_imports('import { Link } from "react-router-dom"')
