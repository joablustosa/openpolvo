/** Desk MVP v0.1 — activo quando `VITE_DESK_MVP_MODE=true` no build Vite. */
export function isDeskMvpMode(): boolean {
  return import.meta.env.VITE_DESK_MVP_MODE === "true";
}
