/** Lê o e-mail do payload JWT (sem verificar assinatura) para mostrar um nome amigável. */
export function displayNameFromToken(token: string | null): string {
  if (!token) return "Visitante";
  try {
    const part = token.split(".")[1];
    if (!part) return "Utilizador";
    const payload = JSON.parse(atob(part)) as { email?: string };
    const email = payload.email ?? "";
    if (email) {
      const local = email.split("@")[0];
      return local ? local.replace(/\./g, " ") : "Utilizador";
    }
    return "Utilizador";
  } catch {
    return "Utilizador";
  }
}
