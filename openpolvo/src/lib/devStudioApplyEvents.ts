/** Eventos globais enquanto o chat aplica ficheiros no projecto (overlay no painel de preview). */

export const DEV_STUDIO_APPLY_START = "dev-studio-apply-start";
export const DEV_STUDIO_APPLY_END = "dev-studio-apply-end";

export function dispatchDevStudioApplyStart(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(DEV_STUDIO_APPLY_START));
}

export function dispatchDevStudioApplyEnd(success: boolean, detail?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DEV_STUDIO_APPLY_END, { detail: { success, detail } }),
  );
}
