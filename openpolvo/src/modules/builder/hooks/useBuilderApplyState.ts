import { useEffect, useRef, useState } from "react";
import { desktopPolvoCode, isElectron, type PolvoCodeEvent } from "@/lib/desktopApi";
import { POLVO_CODE_APPLY_END, POLVO_CODE_APPLY_START } from "@/lib/polvoCodeApplyEvents";
import { BUILDER_APPLY_RESET_MS } from "../config";
import type { CodeApplicationPhase } from "../types";

/**
 * Estado grosso do ciclo aplicar → instalar → preview, alimentado por eventos IPC
 * e pelos eventos `polvo-code-apply-*` disparados em `applyPolvoCodeOpsFromMeta`.
 */
export function useBuilderApplyState(workspacePath: string): CodeApplicationPhase {
  const [phase, setPhase] = useState<CodeApplicationPhase>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setPhase("idle");
      return;
    }

    const clearReset = () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
        resetTimer.current = null;
      }
    };

    const scheduleResetIdle = () => {
      clearReset();
      resetTimer.current = setTimeout(() => {
        setPhase("idle");
        resetTimer.current = null;
      }, BUILDER_APPLY_RESET_MS);
    };

    const onStart = () => {
      clearReset();
      setPhase("applying");
    };
    const onEnd = (ev: Event) => {
      const d = (ev as CustomEvent<{ success?: boolean }>).detail;
      setPhase(d?.success ? "complete" : "error");
      scheduleResetIdle();
    };

    window.addEventListener(POLVO_CODE_APPLY_START, onStart);
    window.addEventListener(POLVO_CODE_APPLY_END, onEnd as EventListener);

    return () => {
      window.removeEventListener(POLVO_CODE_APPLY_START, onStart);
      window.removeEventListener(POLVO_CODE_APPLY_END, onEnd as EventListener);
      clearReset();
    };
  }, [workspacePath]);

  useEffect(() => {
    if (!isElectron() || !workspacePath) return;
    const unsub = desktopPolvoCode.onEvent((ev: PolvoCodeEvent) => {
      if (ev.type === "log" && typeof ev.line === "string") {
        if (ev.line.includes("npm install")) setPhase((p) => (p === "idle" ? p : "installing"));
      }
      if (ev.type === "exit") {
        const ph = "phase" in ev ? String((ev as { phase?: string }).phase ?? "") : "";
        if (ph === "install") setPhase("dev_starting");
      }
      if (ev.type === "url") setPhase((p) => (p === "idle" ? p : "complete"));
    });
    return unsub;
  }, [workspacePath]);

  return phase;
}
