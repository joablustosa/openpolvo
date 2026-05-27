from openpolvointeligence.graphs.preview_source_sanitize import (
    build_router_reference_heal_ops,
    fix_app_tsx_if_router_broken,
    preview_source_has_forbidden_imports,
    sanitize_preview_tsx,
    strip_react_router_jsx,
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


def test_sanitize_app_tsx_router_without_import():
    raw = '''import LandingPage from "@/pages/LandingPage"

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </Router>
  )
}
'''
    out = sanitize_preview_tsx(raw, "src/App.tsx")
    assert "Router" not in out
    assert "Routes" not in out
    assert "Route" not in out
    assert "AppShell" in out
    assert "<LandingPage />" in out


def test_build_router_reference_heal_ops():
    log = "Uncaught ReferenceError: Router is not defined\n    at App (App.tsx:9:6)"
    files = {
        "src/App.tsx": (
            'import LandingPage from "@/pages/LandingPage"\n'
            "export default function App() {\n"
            "  return <Router><Routes><Route path=\"/\" element={<LandingPage />} /></Routes></Router>;\n"
            "}\n"
        ),
        "src/pages/LandingPage.tsx": "export default function LandingPage() { return null }\n",
    }
    ops = build_router_reference_heal_ops(log, files)
    assert ops and len(ops) == 1
    assert ops[0]["path"] == "src/App.tsx"
    body = ops[0]["content"]
    assert "AppShell" in body
    assert "Router" not in body


def test_forbidden_detected():
    assert preview_source_has_forbidden_imports('import { Link } from "react-router-dom"')


def test_strip_router_keeps_element():
    raw = "<Router><Route path=\"/\" element={<Foo />} /></Router>"
    out = strip_react_router_jsx(raw)
    assert "<Foo />" in out
    assert "Router" not in out


def test_fix_app_rebuilds_from_pages():
    app = "export default function App() { return <Router><X /></Router>; }"
    files = {"src/pages/HomePage.tsx": "export default function HomePage(){return null}\n"}
    fixed = fix_app_tsx_if_router_broken(app, files)
    assert "HomePage" in fixed
    assert "AppShell" in fixed
