/**
 * Hook reactivo para o estado dos serviços backend no Electron.
 *
 * Subscreve actualizações em tempo real via IPC (services:statusChanged)
 * e refaz um poll inicial ao montar o componente.
 *
 * Fora do Electron (browser puro) retorna sempre o estado neutro "external".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  desktopServices,
  isElectron,
  type ServicesState,
} from "@/lib/desktopApi";

const NEUTRAL: ServicesState = { api: "external", intelligence: "external" };

export function useDesktopServices() {
  const [status, setStatus] = useState<ServicesState>(NEUTRAL);
  const [autoLaunch, setAutoLaunchState] = useState(false);
  const mountedRef = useRef(true);

  // Poll inicial do estado
  const refresh = useCallback(async () => {
    if (!isElectron()) return;
    try {
      const s = await desktopServices.getStatus();
      if (mountedRef.current) setStatus(s);
    } catch { /* ignora */ }
  }, []);

  // Carregar estado do auto-launch
  const refreshAutoLaunch = useCallback(async () => {
    if (!isElectron()) return;
    try {
      const { desktopApp } = await import("@/lib/desktopApi");
      const v = await desktopApp.getAutoLaunch();
      if (mountedRef.current) setAutoLaunchState(v);
    } catch { /* ignora */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    void refreshAutoLaunch();

    // Subscrever actualizações em tempo real
    const unsub = desktopServices.onStatusChanged((event) => {
      if (!mountedRef.current) return;
      // Ignora eventos de log (muito frequentes) e quaisquer statuses não mapeados
      const knownStatuses: string[] = ["running", "stopped", "starting", "crashed", "restarting", "external", "missing", "error"];
      if (!knownStatuses.includes(event.status)) return;
      setStatus((prev) => ({
        ...prev,
        [event.name]: event.status,
      }));
    });

    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, [refresh, refreshAutoLaunch]);

  /**
   * Alterna o auto-launch e actualiza o estado local.
   */
  const toggleAutoLaunch = useCallback(async () => {
    if (!isElectron()) return;
    try {
      const { desktopApp } = await import("@/lib/desktopApi");
      const newValue = await desktopApp.setAutoLaunch(!autoLaunch);
      if (mountedRef.current) setAutoLaunchState(newValue);
    } catch { /* ignora */ }
  }, [autoLaunch]);

  return { status, autoLaunch, toggleAutoLaunch, refresh };
}
