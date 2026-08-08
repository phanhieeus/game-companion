import { Router } from "express";
import type { Response } from "express";
import { computeScoreboard } from "../domain/scoring.ts";
import type { Tools } from "../tools/index.ts";
import type { SessionRepository } from "../repository/types.ts";
import { createMemory, type FactStore } from "../agent/memory.ts";
import { runAgent, resumeAgent } from "../agent/loop.ts";
import { toolDeclarations } from "../agent/tools.ts";
import type {
  AgentOutcome,
  MemoryStore,
  ToolCall,
  ToolContext,
} from "../agent/types.ts";
import type {
  AgentOutcome as WireOutcome,
  RoundOrder,
} from "../../shared/types.ts";
import { callGemini } from "../gemini.ts";

/**
 * Agent chạy hẳn ở server (ADR 13).
 *
 * Client gửi đúng một câu nói và nhận về kết quả. Nó không biết tool nào tồn
 * tại, không cầm khai báo schema, và quan trọng nhất: **không bao giờ cầm được
 * quyền chạy tool**. Lời gọi đang chờ xác nhận nằm ở đây cho tới khi người dùng
 * chốt qua `/confirm`.
 */

/** Những gì server nhớ giữa hai request của cùng một phiên. */
interface AgentSession {
  memory: MemoryStore;
  /** Lời gọi đang chờ người chốt — chốt chặn HITL sống ở đây (ADR 12). */
  pending: ToolCall | null;
  /**
   * Ý định đổi tuỳ chọn hiển thị, gom lại để trả về cho client tự áp.
   *
   * Thứ tự bảng là tuỳ chọn của người cầm máy chứ không phải dữ liệu ván bài
   * (ADR 5) — server không có quyền và cũng không nên giữ nó.
   */
  uiIntents: { roundOrder?: RoundOrder };
}

export function agentRoutes(
  tools: Tools,
  repo: SessionRepository,
  factStore: FactStore,
): Router {
  const router = Router();
  const sessions = new Map<string, AgentSession>();

  const stateOf = (sessionId: string): AgentSession => {
    let state = sessions.get(sessionId);
    if (!state) {
      state = {
        memory: createMemory(factStore),
        pending: null,
        uiIntents: {},
      };
      sessions.set(sessionId, state);
    }
    return state;
  };

  const contextFor = (sessionId: string, state: AgentSession): ToolContext | null => {
    const session = repo.get(sessionId);
    if (!session) return null;

    return {
      session,
      tools,
      ui: {
        setRoundOrder: (order) => {
          state.uiIntents.roundOrder = order;
        },
      },
      memory: state.memory,
      model: (messages) =>
        callGemini(messages, toolDeclarations(), {
          players: session.players
            .filter((p) => p.status === "active")
            .map((p) => ({ name: p.name })),
          mePlayer: session.players.find((p) => p.id === session.mePlayerId)?.name,
          zeroSum: session.scoringConfig.zeroSum,
          roundsPlayed: session.rounds.filter((r) => r.status === "recorded").length,
          confirmBeforeCommit: session.confirmBeforeCommit,
          memory: state.memory.facts().map((f) => f.text),
        }),
    };
  };

  /**
   * Bỏ `call` trước khi gửi đi.
   *
   * Bản nội bộ mang theo cả tên tool lẫn `thoughtSignature` của Gemini. Client
   * không cần và KHÔNG NÊN biết: nó chỉ trả lời có/không, còn lời gọi thì server
   * giữ. Gửi kèm ra ngoài là mời người ta tự chế request chạy tool tuỳ ý.
   */
  const toWire = (outcome: AgentOutcome): WireOutcome =>
    outcome.type === "confirm"
      ? { type: "confirm", prompt: outcome.prompt, rows: outcome.rows }
      : outcome;

  /** Phiên mới nhất luôn đi kèm kết quả — client không tự tính lại bảng điểm. */
  const reply = (
    res: Response,
    sessionId: string,
    state: AgentSession,
    result: { outcome: AgentOutcome; steps: number },
  ) => {
    const session = repo.get(sessionId)!;
    const uiIntents = state.uiIntents;
    state.uiIntents = {};

    return res.json({
      outcome: toWire(result.outcome),
      steps: result.steps,
      session,
      scoreboard: computeScoreboard(session),
      uiIntents,
    });
  };

  const noSession = (res: Response) =>
    res.status(404).json({
      error: { code: "SESSION_NOT_FOUND", message: "Không có phiên này." },
      retryable: false,
    });

  /** Một lượt nói. */
  router.post("/:id/agent", async (req, res) => {
    const sessionId = req.params.id!;
    const state = stateOf(sessionId);
    const ctx = contextFor(sessionId, state);
    if (!ctx) return noSession(res);

    const text = String(req.body?.text ?? "").trim();
    if (!text) {
      return res.status(400).json({
        error: { code: "EMPTY_UTTERANCE", message: "Chưa nghe được gì." },
        retryable: false,
      });
    }

    // Câu mới trong lúc còn lời gọi treo = người dùng đổi ý. Bỏ lời gọi cũ,
    // đừng để nó nằm đó rồi chốt nhầm ở lần bấm sau.
    state.pending = null;

    const result = await runAgent(text, ctx);
    if (result.outcome.type === "confirm") state.pending = result.outcome.call;

    return reply(res, sessionId, state, result);
  });

  /** Người dùng chốt (hoặc từ chối) lời gọi đang chờ. */
  router.post("/:id/agent/confirm", async (req, res) => {
    const sessionId = req.params.id!;
    const state = stateOf(sessionId);
    const ctx = contextFor(sessionId, state);
    if (!ctx) return noSession(res);

    const call = state.pending;
    if (!call) {
      // 409 chứ không 500: không có gì đang chờ là chuyện bình thường (bấm hai
      // lần, hoặc tải lại trang giữa chừng), không phải server hỏng.
      return res.status(409).json({
        error: { code: "NOTHING_PENDING", message: "Không có gì đang chờ chốt." },
        retryable: false,
      });
    }

    state.pending = null;
    const result = await resumeAgent(call, Boolean(req.body?.accepted), ctx);
    if (result.outcome.type === "confirm") state.pending = result.outcome.call;

    return reply(res, sessionId, state, result);
  });

  return router;
}
