/**
 * Gọi API quan sát (C-023). Token đi kèm mọi request.
 *
 * Token lấy từ `?token=` trên URL rồi cất vào sessionStorage — cất ở
 * sessionStorage chứ không localStorage: đóng tab là mất, đỡ để quên trên máy
 * người khác.
 */

const KEY = "game-companion:admin-token";

export function adminToken(): string {
  const fromUrl = new URLSearchParams(location.search).get("token");
  if (fromUrl) {
    try {
      sessionStorage.setItem(KEY, fromUrl);
    } catch {
      /* chế độ riêng tư — vẫn dùng được trong lần này */
    }
    return fromUrl;
  }
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    headers: { "X-Admin-Token": adminToken() },
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "Trang quan sát chưa bật trên máy chủ này (thiếu ADMIN_TOKEN)."
        : response.status === 401
          ? "Token không đúng."
          : `Máy chủ trả lỗi ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

export interface AdminSession {
  sessionId: string;
  deviceId: string | null;
  turns: number;
  lastAt: string;
  status: string;
  players: string[];
  rounds: number;
}

export interface TraceStep {
  index: number;
  thought: string | null;
  tool: string | null;
  args: unknown;
  observation: unknown;
  prompt: string | null;
  modelMs: number | null;
  toolMs: number | null;
}

export interface TraceTurn {
  id: string;
  sessionId: string;
  deviceId: string | null;
  at: string;
  text: string;
  steps: TraceStep[];
  guardrails: { name: string; message: string; detail: Record<string, unknown> }[];
  outcome: string | null;
  totalMs: number | null;
}

export interface Stats {
  turns: number;
  outcomes: Record<string, number>;
  guardrails: Record<string, number>;
  steps: { avg: number; max: number; distribution: Record<string, number> };
  latencyMs: { p50: number; p95: number; max: number };
  /**
   * Số phiên agent server đang giữ trong RAM, và trần của nó (C-029).
   *
   * Không suy ra được từ danh sách phiên: kho vết nhớ cả phiên đã tắt từ lâu,
   * còn RAM thì chỉ giữ những phiên chưa bị dọn. Hai con số khác nhau, và cái
   * đáng lo là cái này.
   */
  sessionsInMemory: { count: number; limit: number };
}

export const listSessions = () =>
  get<{ sessions: AdminSession[] }>("/sessions").then((r) => r.sessions);

export const listTurns = (id: string) =>
  get<{ turns: TraceTurn[] }>(`/sessions/${id}/turns`).then((r) => r.turns);

export const getStats = () => get<Stats>("/stats");
