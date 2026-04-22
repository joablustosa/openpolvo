/** Credenciais guardadas no app desktop (processo principal + safeStorage). */

export type SavedCredentials = { email: string; password: string };

export type CredentialSaveResult = { ok: true } | { ok: false; error: string };

export function isElectronShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.smartagent?.isElectron);
}

export async function isCredentialStorageAvailable(): Promise<boolean> {
  const api = window.smartagent?.credentials;
  if (!api?.isEncryptionAvailable) return false;
  try {
    return await api.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function loadSavedCredentials(): Promise<SavedCredentials | null> {
  const api = window.smartagent?.credentials;
  if (!api?.load) return null;
  try {
    const res = (await api.load()) as {
      ok?: boolean;
      data?: SavedCredentials | null;
      error?: string;
    };
    if (!res?.ok || !res.data) return null;
    const { email, password } = res.data;
    if (typeof email !== "string" || typeof password !== "string") return null;
    return { email, password };
  } catch {
    return null;
  }
}

export async function saveCredentialsToDisk(creds: SavedCredentials): Promise<CredentialSaveResult> {
  const api = window.smartagent?.credentials;
  if (!api?.save) return { ok: false, error: "Indisponível neste ambiente." };
  try {
    const res = (await api.save({
      email: creds.email.trim(),
      password: creds.password,
    })) as { ok?: boolean; error?: string };
    if (res?.ok) return { ok: true };
    return { ok: false, error: res?.error ?? "Não foi possível guardar." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao guardar." };
  }
}

export async function clearSavedCredentials(): Promise<void> {
  const api = window.smartagent?.credentials;
  if (!api?.clear) return;
  try {
    await api.clear();
  } catch {
    /* noop */
  }
}
