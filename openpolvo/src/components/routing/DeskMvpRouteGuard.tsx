import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { isDeskMvpMode } from "@/lib/deskMvpMode";

/** Redirecciona rotas legacy quando o Desk MVP mode está activo. */
export function DeskMvpRouteGuard({ children }: { children: ReactNode }) {
  if (isDeskMvpMode()) {
    return <Navigate to="/" replace />;
  }
  return children;
}
