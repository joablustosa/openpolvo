/** Eventos de ciclo de vida da aplicação automática de ficheiros Polvo Code (sem dependência de desktopApi). */

export const POLVO_CODE_APPLY_START = "polvo-code-apply-start";
export const POLVO_CODE_APPLY_END = "polvo-code-apply-end";

export function dispatchPolvoCodeApplyStart(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(POLVO_CODE_APPLY_START));
}

export function dispatchPolvoCodeApplyEnd(success: boolean, detail?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(POLVO_CODE_APPLY_END, { detail: { success, detail } }),
  );
}
