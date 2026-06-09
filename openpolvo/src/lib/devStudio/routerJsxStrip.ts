/**
 * Helpers para JSX react-router — scaffold inclui react-router-dom.
 */

const ROUTER_JSX_RE = /<\/(?:Router|Routes|Route|BrowserRouter|Navigate)\b/i;

export function usesRouterJsx(content: string): boolean {
  return ROUTER_JSX_RE.test(content) || /<(?:Router|Routes|Route|BrowserRouter)\b/i.test(content);
}

export function stripReactRouterJsx(content: string): string {
  return content;
}

function inferMainPage(
  appContent: string,
  projectFiles?: Record<string, string>,
): { importLine: string; component: string; showSidebar: boolean } {
  const showSidebar = appContent.includes("showSidebar");

  const pageImp = appContent.match(/import\s+(\w+)\s+from\s+["']@\/pages\/(\w+)["']/);
  if (pageImp) {
    const name = pageImp[1];
    return {
      importLine: `import ${name} from "@/pages/${pageImp[2]}"`,
      component: name,
      showSidebar,
    };
  }

  const elementMatch = appContent.match(/element=\{\s*<(\w+)/);
  if (elementMatch) {
    const name = elementMatch[1];
    const imp = appContent.match(
      new RegExp(`import\\s+(?:\\{[^}]*\\b)?${name}\\b[^;]*from\\s+["']([^"']+)["']`),
    );
    if (imp) {
      return { importLine: `import ${name} from "${imp[1]}"`, component: name, showSidebar };
    }
    const guess = `src/pages/${name}.tsx`;
    if (projectFiles && Object.keys(projectFiles).some((k) => k.replace(/\\/g, "/") === guess)) {
      return {
        importLine: `import ${name} from "@/pages/${name}"`,
        component: name,
        showSidebar,
      };
    }
  }

  const pages = Object.keys(projectFiles ?? {})
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p.startsWith("src/pages/") && /\.(tsx|jsx)$/.test(p))
    .sort();

  for (const pref of ["LandingPage", "HomePage", "DashboardPage", "Index", "Page"]) {
    for (const p of pages) {
      const base = p.split("/").pop() ?? "";
      const name = base.replace(/\.(tsx|jsx)$/i, "");
      if (name.toLowerCase().includes(pref.toLowerCase())) {
        return {
          importLine: `import ${name} from "@/pages/${name}"`,
          component: name,
          showSidebar,
        };
      }
    }
  }

  if (pages.length) {
    const base = pages[0].split("/").pop() ?? "Page";
    const name = base.replace(/\.(tsx|jsx)$/i, "");
    return {
      importLine: `import ${name} from "@/pages/${name}"`,
      component: name,
      showSidebar,
    };
  }

  return { importLine: "", component: "", showSidebar };
}

export function rebuildAppTsxWithoutRouter(
  appContent: string,
  projectFiles?: Record<string, string>,
): string {
  const { importLine, component, showSidebar } = inferMainPage(appContent, projectFiles);
  const sidebarAttr = showSidebar ? " showSidebar" : "";
  const lines = [
    'import { Navigate, Route, Routes } from "react-router-dom";',
    'import AppShell from "@/components/layout/AppShell";',
  ];
  if (importLine) lines.push(importLine);
  lines.push(
    "",
    "export default function App() {",
    "  return (",
    `    <AppShell${sidebarAttr}>`,
    "      <Routes>",
  );
  if (component) {
    lines.push(`        <Route path="/" element={<${component} />} />`);
  } else {
    lines.push(
      '        <Route path="/" element={<section className="flex flex-1 flex-col items-center justify-center px-6 py-24"><p className="text-muted-foreground">Preview</p></section>} />',
    );
  }
  lines.push(
    '        <Route path="*" element={<Navigate to="/" replace />} />',
    "      </Routes>",
    "    </AppShell>",
    "  );",
    "}",
  );
  return `${lines.join("\n")}\n`;
}

export function fixAppTsxIfRouterBroken(
  content: string,
  projectFiles?: Record<string, string>,
): string {
  if (usesRouterJsx(content) && !content.includes("react-router-dom")) {
    return rebuildAppTsxWithoutRouter(content, projectFiles);
  }
  if (/\bRouter\b/.test(content) && !content.includes("react-router")) {
    return rebuildAppTsxWithoutRouter(content, projectFiles);
  }
  return content;
}

const REFERENCE_ROUTER_RE = /ReferenceError:\s*Router\s+is not defined/i;

export function buildRouterReferenceHealOps(
  compileLog: string,
  projectFiles: Record<string, string>,
): import("@/lib/devStudioMetadata").DevStudioOp[] | null {
  if (!REFERENCE_ROUTER_RE.test(compileLog)) return null;
  const app =
    projectFiles["src/App.tsx"] ?? projectFiles["src\\App.tsx"];
  if (!app) return null;
  const fixed = fixAppTsxIfRouterBroken(app, projectFiles);
  if (fixed.trim() === app.trim()) return null;
  return [{ op: "write", path: "src/App.tsx", content: fixed }];
}
