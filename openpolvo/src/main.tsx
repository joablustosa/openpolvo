import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { WorkspaceProvider } from "./core/WorkspaceContext";
import { TooltipProvider } from "./components/ui/tooltip";
import { desktopLogs } from "./lib/desktopApi";
import "./index.css";

const Router: typeof BrowserRouter =
  typeof window !== "undefined" && (window as any).smartagent?.isElectron
    ? (HashRouter as any)
    : BrowserRouter;

if (typeof window !== "undefined" && (window as any).smartagent?.isElectron) {
  window.addEventListener("error", (evt) => {
    const msg = evt.error?.stack || evt.message || "renderer error";
    void desktopLogs.append("renderer", msg);
  });
  window.addEventListener("unhandledrejection", (evt) => {
    const r: any = (evt as any).reason;
    const msg = r?.stack || String(r ?? "unhandledrejection");
    void desktopLogs.append("renderer", `unhandledrejection: ${msg}`);
  });
}

/** Evita ecrã totalmente branco se o mount inicial falhar (mostra mensagem mínima). */
class RootErrorBoundary extends Component<
  { children: ReactNode },
  { err: Error | null }
> {
  state = { err: null as Error | null };

  static getDerivedStateFromError(err: Error) {
    return { err };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("RootErrorBoundary", err, info.componentStack);
    if ((window as any).smartagent?.isElectron) {
      void desktopLogs.append("renderer", `RootErrorBoundary: ${err.stack ?? err.message}`);
    }
  }

  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            minHeight: "100vh",
            padding: 24,
            background: "#0c0c0c",
            color: "#f5f5f5",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: 18, marginBottom: 12 }}>Erro ao iniciar a interface</h1>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, opacity: 0.9 }}>
            {this.state.err.message}
          </pre>
          <p style={{ marginTop: 16, fontSize: 13, opacity: 0.75 }}>
            Tenta recarregar (Ctrl+R). Em desenvolvimento, confirma o Vite em{" "}
            <strong>http://127.0.0.1:5174</strong> e a API Go em <strong>:8081</strong>.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <StrictMode>
      <AuthProvider>
        <WorkspaceProvider>
          <TooltipProvider delay={400}>
            <Router>
              <App />
            </Router>
          </TooltipProvider>
        </WorkspaceProvider>
      </AuthProvider>
    </StrictMode>
  </RootErrorBoundary>,
);
