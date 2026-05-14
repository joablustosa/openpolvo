/** Erro HTTP da API com código de estado para tratamento (ex.: 401 sem mostrar texto cru no chat). */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Após {@link forceReloginRedirect}; o handler não deve abrir modal nem mostrar o erro cru. */
export class SessionReloginRedirected extends Error {
  constructor() {
    super("SESSION_RELOGIN_REDIRECTED");
    this.name = "SessionReloginRedirected";
  }
}

/** Resposta 502/503 da API Go quando o Intelligence devolve 401 (chave interna inválida / não autorizado). */
export function errorMessageIndicatesPolvointelUnauthorized(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("polvointel: stream 401") ||
    m.includes("polvointel: reply 401") ||
    m.includes("polvointel: unauthorized")
  );
}

export function httpStatusAndMessageIndicateForcedRelogin(
  status: number,
  message: string,
): boolean {
  if (status === 401) return true;
  if (status === 502 || status === 503 || status === 504) {
    return errorMessageIndicatesPolvointelUnauthorized(message);
  }
  return false;
}

export function isApiUnauthorized(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 401;
}
