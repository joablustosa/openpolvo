/** Erro HTTP da API com código de estado para tratamento (ex.: 401 sem mostrar texto cru no chat). */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isApiUnauthorized(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 401;
}
