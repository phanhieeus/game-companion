import type {
  AgentReply,
  RoundEvent,
  Scoreboard,
  Session,
  SessionView,
} from "./model";
import { deviceId } from "./device";

/**
 * Chỗ DUY NHẤT trong client biết HTTP tồn tại (ADR 13).
 *
 * Phần còn lại của frontend chỉ gọi hàm và nhận về `Session`. Nhờ vậy khi đổi
 * đường truyền (thêm retry, đổi base URL, chuyển sang websocket) thì chỉ sửa
 * file này, và không component nào phải biết mình đang chờ mạng.
 */

export type { AgentReply, SessionView };

/**
 * Lỗi có mã, để UI phân biệt "nói sai luật" với "mất mạng".
 *
 * `retryable` quyết định có hiện nút Thử lại hay không: bấm lại một câu sai luật
 * zero-sum thì vẫn sai y hệt, hiện nút chỉ để người ta bấm hai lần rồi bực.
 */
export class ApiError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = retryable;
  }
}

const OFFLINE = "Không nối được máy chủ. Kiểm tra mạng rồi thử lại.";

async function call<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init?.method ?? "GET",
      // Gửi ở MỌI request, không chỉ lúc tạo phiên: server dùng nó để biết
      // "ván bài của máy này" là ván nào (ADR 15).
      headers: {
        "X-Device-Id": deviceId(),
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    // Dữ liệu giờ nằm ở server, nên mất mạng là KHÔNG dùng được — phải nói
    // thẳng. Trước đây app chạy offline vì mọi thứ nằm ngay trên máy (ADR 13).
    throw new ApiError("OFFLINE", OFFLINE, true);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
      retryable?: boolean;
    } | null;
    throw new ApiError(
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? `Máy chủ trả lỗi ${response.status}.`,
      body?.retryable ?? response.status >= 500,
    );
  }

  return (await response.json()) as T;
}

/* ── Máy chủ ──────────────────────────────────────────────────────────── */

/** Giới hạn số người chơi do SERVER quyết — client chỉ hiện form theo. */
export const health = () =>
  call<{
    ok: boolean;
    model: string;
    hasKey: boolean;
    minPlayers: number;
    maxPlayers: number;
  }>("/health");

/* ── Phiên ────────────────────────────────────────────────────────────── */

export const createSession = (players: string[], meName: string | null) =>
  call<SessionView>("/sessions", {
    method: "POST",
    body: {
      players: players.map((name) => ({ name })),
      ...(meName ? { me_player_name: meName } : {}),
    },
  });

/** Mở lại app là tiếp tục phiên đang chơi — giờ hỏi server, không hỏi máy mình. */
export const activeSession = () =>
  call<{ session: Session | null; scoreboard: Scoreboard | null }>(
    "/sessions/active",
  );

export const getSession = (id: string) => call<SessionView>(`/sessions/${id}`);

export const endSession = (id: string) =>
  call<SessionView>(`/sessions/${id}/end`, { method: "POST" });

export const setConfirmBeforeCommit = (id: string, enabled: boolean) =>
  call<SessionView>(`/sessions/${id}/settings`, {
    method: "PATCH",
    body: { confirm_before_commit: enabled },
  });

/* ── Ván ──────────────────────────────────────────────────────────────── */

export const recordRound = (
  id: string,
  entries: { playerId: string; delta: number }[],
) =>
  call<SessionView>(`/sessions/${id}/rounds`, {
    method: "POST",
    body: { entries, client_request_id: `manual-${Date.now()}` },
  });

export const updateRound = (
  id: string,
  roundId: string,
  entries: { playerId: string; delta: number }[],
) =>
  call<SessionView>(`/sessions/${id}/rounds/${roundId}`, {
    method: "PATCH",
    body: { entries },
  });

export const deleteRound = (id: string, roundId: string) =>
  call<SessionView>(`/sessions/${id}/rounds/${roundId}`, { method: "DELETE" });

export const roundEvents = (id: string, roundId: string) =>
  call<{ events: RoundEvent[] }>(`/sessions/${id}/rounds/${roundId}/events`);

/* ── Hoàn tác ─────────────────────────────────────────────────────────── */

export const undoLast = (id: string) =>
  call<SessionView & { label: string }>(`/sessions/${id}/undo`, {
    method: "POST",
  });

export const redoLast = (id: string) =>
  call<SessionView & { label: string }>(`/sessions/${id}/redo`, {
    method: "POST",
  });

export const undoState = (id: string) =>
  call<{ undo: string | null; redo: string | null }>(
    `/sessions/${id}/undo-state`,
  );

/* ── Agent ────────────────────────────────────────────────────────────── */

/** Một lượt nói. Client gửi đúng một câu và nhận kết quả — không biết tool nào. */
export const sendUtterance = (id: string, text: string) =>
  call<AgentReply>(`/sessions/${id}/agent`, { method: "POST", body: { text } });

/** Chốt (hoặc từ chối) đề xuất đang chờ. Lời gọi nằm ở server, client chỉ ừ/không. */
export const confirmPending = (id: string, accepted: boolean) =>
  call<AgentReply>(`/sessions/${id}/agent/confirm`, {
    method: "POST",
    body: { accepted },
  });
