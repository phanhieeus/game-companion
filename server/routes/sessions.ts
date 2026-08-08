import { Router } from "express";
import type { Request, Response } from "express";
import { computeScoreboard } from "../domain/scoring.ts";
import type { Result } from "../domain/errors.ts";
import type { Tools } from "../tools/index.ts";
import type { SessionRepository } from "../repository/types.ts";

/**
 * REST cho mọi thao tác TAY trên phiên (ADR 13).
 *
 * Mọi endpoint đi qua đúng tool layer đã có — không có đường nào chạm thẳng vào
 * repository. Nhờ vậy validate zero-sum, nhật ký và undo/redo dùng chung một
 * đường với agent, y như hồi tool layer còn chạy trong trình duyệt.
 */

/**
 * Đưa `Result` của tool layer ra HTTP, GIỮ NGUYÊN `code`.
 *
 * MỌI `ErrorCode` trong `domain/errors.ts` đều là "người dùng/luật chơi", không
 * có mã nào nghĩa là "máy hỏng" — nên tất cả ra 400 và `retryable: false`. Nói
 * lại y hệt câu cũ thì vẫn sai y hệt. Lỗi hạ tầng đi đường khác: chúng ném
 * exception và rơi vào error handler ở `index.ts`, thành 500.
 *
 * Giữ `code` vì client cần phân biệt "tổng ván chưa bằng 0" với "mất mạng" để
 * quyết có hiện nút Thử lại hay không. Nuốt thành một câu chữ chung là làm mất
 * đúng thông tin đó.
 */
function send<T>(res: Response, result: Result<T>, shape: (data: T) => unknown) {
  if (!result.ok) {
    return res.status(400).json({
      error: { code: result.error.code, message: result.error.message },
      retryable: false,
    });
  }
  return res.json(shape(result.data));
}

export function sessionRoutes(tools: Tools, repo: SessionRepository): Router {
  const router = Router();

  /** Phiên + bảng điểm luôn đi cùng nhau: client không tự tính điểm nữa. */
  const view = (sessionId: string) => {
    const session = repo.get(sessionId);
    if (!session) return null;
    return { session, scoreboard: computeScoreboard(session) };
  };

  const withSession = (res: Response, sessionId: string) => {
    const payload = view(sessionId);
    if (!payload) {
      return res.status(404).json({
        error: { code: "SESSION_NOT_FOUND", message: "Không có phiên này." },
        retryable: false,
      });
    }
    return res.json(payload);
  };

  router.post("/", (req: Request, res: Response) => {
    const { players, me_player_name } = req.body ?? {};
    const result = tools.create_session({
      players: Array.isArray(players) ? players : [],
      ...(me_player_name ? { me_player_name } : {}),
    });
    return send(res, result, (data) => view(data.session_id));
  });

  /** Mở lại app là tiếp tục phiên đang chơi — giờ hỏi server, không hỏi máy mình. */
  router.get("/active", (_req: Request, res: Response) => {
    const active = repo.activeSession();
    if (!active) return res.json({ session: null, scoreboard: null });
    return res.json(view(active.id));
  });

  router.get("/:id", (req, res) => withSession(res, req.params.id!));

  router.post("/:id/rounds", (req, res) => {
    const { entries, client_request_id } = req.body ?? {};
    const result = tools.record_round({
      session_id: req.params.id!,
      entries: entries ?? [],
      ...(client_request_id ? { client_request_id } : {}),
      source: "manual",
    });
    return send(res, result, () => view(req.params.id!));
  });

  router.patch("/:id/rounds/:roundId", (req, res) => {
    const result = tools.update_round({
      session_id: req.params.id!,
      round_id: req.params.roundId!,
      entries: req.body?.entries ?? [],
      source: "manual",
    });
    return send(res, result, () => view(req.params.id!));
  });

  router.delete("/:id/rounds/:roundId", (req, res) => {
    const result = tools.undo_round({
      session_id: req.params.id!,
      round_id: req.params.roundId!,
      source: "manual",
    });
    return send(res, result, () => view(req.params.id!));
  });

  router.get("/:id/rounds/:roundId/events", (req, res) => {
    const result = tools.get_round_events({
      session_id: req.params.id!,
      round_id: req.params.roundId!,
    });
    return send(res, result, (data) => data);
  });

  router.post("/:id/undo", (req, res) => {
    const result = tools.undo_last({ session_id: req.params.id! });
    return send(res, result, (data) => ({
      ...view(req.params.id!),
      label: data.label,
    }));
  });

  router.post("/:id/redo", (req, res) => {
    const result = tools.redo_last({ session_id: req.params.id! });
    return send(res, result, (data) => ({
      ...view(req.params.id!),
      label: data.label,
    }));
  });

  /** Nút hoàn tác/làm lại phải biết còn gì để làm không, trước khi bấm. */
  router.get("/:id/undo-state", (req, res) => {
    const result = tools.get_undo_state({ session_id: req.params.id! });
    return send(res, result, (data) => data);
  });

  router.post("/:id/players", (req, res) => {
    const result = tools.add_player({
      session_id: req.params.id!,
      name: req.body?.name ?? "",
    });
    return send(res, result, () => view(req.params.id!));
  });

  router.delete("/:id/players/:playerId", (req, res) => {
    const result = tools.remove_player({
      session_id: req.params.id!,
      player_id: req.params.playerId!,
    });
    return send(res, result, () => view(req.params.id!));
  });

  router.patch("/:id/settings", (req, res) => {
    const result = tools.set_confirm_before_commit({
      session_id: req.params.id!,
      enabled: Boolean(req.body?.confirm_before_commit),
    });
    return send(res, result, () => view(req.params.id!));
  });

  router.post("/:id/end", (req, res) => {
    const result = tools.end_session({ session_id: req.params.id! });
    return send(res, result, () => view(req.params.id!));
  });

  return router;
}
