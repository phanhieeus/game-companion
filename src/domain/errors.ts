/** Mã lỗi — hợp đồng ổn định, xem docs/product/tools.md. */
export type ErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_ENDED"
  | "PLAYER_NOT_IN_SESSION"
  | "TOO_FEW_PLAYERS"
  | "TOO_MANY_PLAYERS"
  | "SUM_DELTA_NOT_ZERO"
  | "NEGATIVE_NOT_ALLOWED"
  | "DUPLICATE_PLAYER_IN_ROUND"
  | "EMPTY_ROUND"
  | "ROUND_NOT_FOUND"
  | "NO_ROUND_TO_UNDO";

export interface ToolError {
  code: ErrorCode;
  message: string;
}

export type Result<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: ToolError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data, error: null };
}

export function err<T = never>(code: ErrorCode, message: string): Result<T> {
  return { ok: false, data: null, error: { code, message } };
}
