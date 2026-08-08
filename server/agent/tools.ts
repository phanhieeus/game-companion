import { computeScoreboard } from "../domain/scoring.ts";
import type { AgentTool, ProposalRow, ToolContext, ToolResult } from "./types.ts";

const ok = (data: unknown, extra: Partial<ToolResult> = {}): ToolResult => ({
  ok: true,
  data,
  ...extra,
});

const fail = (message: string): ToolResult => ({
  ok: false,
  data: { error: message },
});

/**
 * Khoá chống ghi trùng cho mỗi lần agent gọi record_round.
 *
 * Chỉ dùng Date.now() thì hai ván ghi trong cùng một mili-giây mang chung khoá,
 * và tool layer coi ván thứ hai là gửi lại của ván thứ nhất → nuốt mất một ván.
 * Người nói không nhanh tới vậy, nhưng vòng ReAct thì có.
 */
let requestSeq = 0;
const nextRequestId = () => `agent-${Date.now()}-${(requestSeq += 1)}`;

const num = (v: unknown): number => Number(v);
const str = (v: unknown): string => String(v ?? "");

/** Tên → id, chịu được sai chính tả nhẹ do nhận dạng giọng nói. */
function findPlayer(ctx: ToolContext, nameOrId: string) {
  const active = ctx.session.players.filter((p) => p.status === "active");
  const needle = nameOrId.trim().toLowerCase();

  return (
    active.find((p) => p.id === nameOrId) ??
    active.find((p) => p.name.toLowerCase() === needle) ??
    // "Hùn" → "Hùng": khớp tiền tố khi chỉ có đúng một ứng viên.
    (active.filter((p) => p.name.toLowerCase().startsWith(needle)).length === 1
      ? active.find((p) => p.name.toLowerCase().startsWith(needle))
      : undefined)
  );
}

function entriesFrom(
  ctx: ToolContext,
  raw: unknown,
): { entries: { playerId: string; delta: number }[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Thiếu danh sách điểm." };

  const entries: { playerId: string; delta: number }[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const player = findPlayer(ctx, str(item.player));
    if (!player) return { error: `Không rõ "${str(item.player)}" là ai.` };
    entries.push({ playerId: player.id, delta: num(item.delta) });
  }
  return { entries };
}

/** Mô tả ván bằng lời để đọc lên khi xin xác nhận. */
function describeEntries(
  ctx: ToolContext,
  entries: { playerId: string; delta: number }[],
): string {
  return entries
    .slice()
    .sort((a, b) => b.delta - a.delta)
    .map((e) => {
      const name =
        ctx.session.players.find((p) => p.id === e.playerId)?.name ?? "?";
      return `${name} ${e.delta > 0 ? `+${e.delta}` : e.delta}`;
    })
    .join(", ");
}

/**
 * Ván đề xuất, dạng vẽ được lên thẻ xác nhận.
 *
 * Tham số model gửi sang không đọc được (sai tên, thiếu mảng) thì trả `null` —
 * UI lùi về câu chữ chứ không vẽ thẻ rỗng.
 */
function proposeEntries(
  ctx: ToolContext,
  raw: unknown,
): ProposalRow[] | null {
  const parsed = entriesFrom(ctx, raw);
  if ("error" in parsed) return null;

  return parsed.entries.map((e) => ({
    playerId: e.playerId,
    name: ctx.session.players.find((p) => p.id === e.playerId)?.name ?? "?",
    delta: e.delta,
  }));
}

const entriesSchema = {
  type: "array",
  description: "Điểm từng người trong ván. Tổng phải bằng 0.",
  items: {
    type: "object",
    properties: {
      player: { type: "string", description: "Tên người chơi" },
      delta: { type: "integer", description: "Điểm cộng (dương) hoặc trừ (âm)" },
    },
    required: ["player", "delta"],
  },
} as const;

/**
 * Danh mục tool của agent.
 *
 * Nguyên tắc: **agent làm được đúng những gì tay làm được** — không hơn, không
 * kém. Mỗi tool đi qua đúng tool layer đã có (decision 0001), nên validate
 * zero-sum, nhật ký, undo/redo dùng chung một đường, không có lối tắt.
 *
 * `needsConfirm` khai ở đây chứ không để model tự quyết (ADR 12).
 */
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "record_round",
    description:
      "Ghi một ván mới. Chỉ gọi khi đã biết đủ điểm của từng người và tổng bằng 0.",
    parameters: {
      type: "object",
      properties: { entries: entriesSchema },
      required: ["entries"],
    },
    needsConfirm: (_a, ctx) => ctx.session.confirmBeforeCommit,
    describe: (args, ctx) => {
      const parsed = entriesFrom(ctx, args.entries);
      if ("error" in parsed) return "Ghi ván này nhé?";
      return `${describeEntries(ctx, parsed.entries)}. Ghi ván này nhé?`;
    },
    propose: (args, ctx) => proposeEntries(ctx, args.entries),
    run(args, ctx) {
      const parsed = entriesFrom(ctx, args.entries);
      if ("error" in parsed) return fail(parsed.error);

      const result = ctx.tools.record_round({
        session_id: ctx.session.id,
        entries: parsed.entries,
        client_request_id: nextRequestId(),
        source: "voice",
      });
      if (!result.ok) return fail(result.error.message);

      const seq = ctx.tools.get_history({ session_id: ctx.session.id, limit: 1 })
        .data?.rounds[0]?.sequenceNo;
      return ok({ recorded: true, round: seq, scoreboard: result.data.scoreboard }, {
        changed: true,
      });
    },
  },

  {
    name: "update_round",
    description:
      "Sửa điểm của một ván đã ghi. Cho số thứ tự ván và điểm mới của TẤT CẢ những người có điểm trong ván đó.",
    parameters: {
      type: "object",
      properties: {
        round: { type: "integer", description: "Số thứ tự ván cần sửa" },
        entries: entriesSchema,
      },
      required: ["round", "entries"],
    },
    needsConfirm: () => true,
    describe: (args, ctx) => {
      const parsed = entriesFrom(ctx, args.entries);
      const what = "error" in parsed ? "" : `${describeEntries(ctx, parsed.entries)}. `;
      return `${what}Sửa ván ${num(args.round)} thành vậy nhé?`;
    },
    propose: (args, ctx) => proposeEntries(ctx, args.entries),
    run(args, ctx) {
      const target = ctx.session.rounds.find(
        (r) => r.sequenceNo === num(args.round) && r.status === "recorded",
      );
      if (!target) return fail(`Không có ván ${num(args.round)} đang hiệu lực.`);

      const parsed = entriesFrom(ctx, args.entries);
      if ("error" in parsed) return fail(parsed.error);

      const result = ctx.tools.update_round({
        session_id: ctx.session.id,
        round_id: target.id,
        entries: parsed.entries,
        source: "voice",
      });
      if (!result.ok) return fail(result.error.message);
      return ok({ updated: true, scoreboard: result.data.scoreboard }, { changed: true });
    },
  },

  {
    name: "delete_round",
    description: "Xóa (hủy) một ván. Bỏ trống số ván thì hủy ván gần nhất.",
    parameters: {
      type: "object",
      properties: { round: { type: "integer", description: "Số thứ tự ván" } },
    },
    needsConfirm: () => true,
    describe: (args, ctx) => {
      const seq =
        args.round === undefined
          ? ctx.session.rounds
              .filter((r) => r.status === "recorded")
              .reduce((m, r) => Math.max(m, r.sequenceNo), 0)
          : num(args.round);
      return `Xóa ván ${seq} nhé?`;
    },
    run(args, ctx) {
      const target =
        args.round === undefined
          ? undefined
          : ctx.session.rounds.find(
              (r) => r.sequenceNo === num(args.round) && r.status === "recorded",
            );
      if (args.round !== undefined && !target) {
        return fail(`Không có ván ${num(args.round)} đang hiệu lực.`);
      }

      const result = ctx.tools.undo_round({
        session_id: ctx.session.id,
        ...(target ? { round_id: target.id } : {}),
        source: "voice",
      });
      if (!result.ok) return fail(result.error.message);
      return ok({ deleted: true, scoreboard: result.data.scoreboard }, { changed: true });
    },
  },

  {
    name: "undo",
    description: "Hoàn tác thao tác gần nhất (thêm, sửa hoặc xóa ván).",
    parameters: { type: "object", properties: {} },
    run(_a, ctx) {
      const result = ctx.tools.undo_last({ session_id: ctx.session.id });
      if (!result.ok) return fail(result.error.message);
      return ok({ label: result.data.label }, { changed: true, say: result.data.label });
    },
  },

  {
    name: "redo",
    description: "Làm lại thao tác vừa hoàn tác.",
    parameters: { type: "object", properties: {} },
    run(_a, ctx) {
      const result = ctx.tools.redo_last({ session_id: ctx.session.id });
      if (!result.ok) return fail(result.error.message);
      return ok({ label: result.data.label }, { changed: true, say: result.data.label });
    },
  },

  {
    name: "get_scoreboard",
    description: "Xem điểm tổng và thứ hạng hiện tại của cả làng.",
    parameters: { type: "object", properties: {} },
    run(_a, ctx) {
      return ok(
        computeScoreboard(ctx.session).rows.map((r) => ({
          name: r.name,
          total: r.total,
          rank: r.rank,
        })),
      );
    },
  },

  {
    name: "get_history",
    description: "Xem điểm chi tiết của các ván gần đây.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", description: "Số ván gần nhất" } },
    },
    run(args, ctx) {
      const limit = args.limit === undefined ? 5 : num(args.limit);
      const rounds = ctx.session.rounds
        .filter((r) => r.status === "recorded")
        .sort((a, b) => b.sequenceNo - a.sequenceNo)
        .slice(0, limit)
        .map((r) => ({
          round: r.sequenceNo,
          entries: r.entries.map((e) => ({
            name:
              ctx.session.players.find((p) => p.id === e.playerId)?.name ?? "?",
            delta: e.delta,
          })),
        }));
      return ok(rounds);
    },
  },

  {
    name: "add_player",
    description: "Thêm một người chơi mới vào phiên.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    needsConfirm: () => true,
    describe: (args) => `Thêm ${str(args.name)} vào phiên nhé?`,
    run(args, ctx) {
      const result = ctx.tools.add_player({
        session_id: ctx.session.id,
        name: str(args.name),
      });
      if (!result.ok) return fail(result.error.message);
      return ok({ added: str(args.name) }, { changed: true });
    },
  },

  {
    name: "remove_player",
    description: "Cho một người rời phiên. Các ván cũ của họ vẫn giữ nguyên.",
    parameters: {
      type: "object",
      properties: { player: { type: "string" } },
      required: ["player"],
    },
    needsConfirm: () => true,
    describe: (args) => `Cho ${str(args.player)} rời phiên nhé?`,
    run(args, ctx) {
      const player = findPlayer(ctx, str(args.player));
      if (!player) return fail(`Không rõ "${str(args.player)}" là ai.`);

      const result = ctx.tools.remove_player({
        session_id: ctx.session.id,
        player_id: player.id,
      });
      if (!result.ok) return fail(result.error.message);
      return ok({ removed: player.name }, { changed: true });
    },
  },

  {
    name: "set_round_order",
    description:
      "Đổi thứ tự hiện ván trong bảng: mới nhất ở trên hay ở dưới.",
    parameters: {
      type: "object",
      properties: {
        order: {
          type: "string",
          enum: ["newest-last", "newest-first"],
          description: "newest-last = ván mới nhất ở dưới",
        },
      },
      required: ["order"],
    },
    run(args, ctx) {
      const order = str(args.order) === "newest-first" ? "newest-first" : "newest-last";
      ctx.ui.setRoundOrder(order);
      return ok({ order }, { changed: true });
    },
  },

  {
    name: "set_confirm",
    description:
      "Bật hoặc tắt việc hỏi xác nhận trước khi ghi điểm.",
    parameters: {
      type: "object",
      properties: { enabled: { type: "boolean" } },
      required: ["enabled"],
    },
    needsConfirm: () => true,
    describe: (args) =>
      args.enabled ? "Bật xác nhận trước khi ghi nhé?" : "Tắt xác nhận trước khi ghi nhé?",
    run(args, ctx) {
      const result = ctx.tools.set_confirm_before_commit({
        session_id: ctx.session.id,
        enabled: Boolean(args.enabled),
      });
      if (!result.ok) return fail(result.error.message);
      return ok({ enabled: Boolean(args.enabled) }, { changed: true });
    },
  },

  {
    name: "end_session",
    description: "Kết thúc phiên chơi và chốt tổng.",
    parameters: { type: "object", properties: {} },
    needsConfirm: () => true,
    describe: () => "Kết thúc phiên và chốt tổng nhé?",
    run(_a, ctx) {
      const result = ctx.tools.end_session({ session_id: ctx.session.id });
      if (!result.ok) return fail(result.error.message);
      return ok({ ended: true }, { changed: true });
    },
  },

  {
    name: "remember",
    description:
      "Ghi nhớ lâu dài một điều về nhóm này: biệt danh, luật nhà, thói quen. Dùng khi người dùng bảo 'nhớ là...' hoặc khi học được điều sẽ hữu ích cho lần sau.",
    parameters: {
      type: "object",
      properties: { fact: { type: "string", description: "Điều cần nhớ, một câu ngắn" } },
      required: ["fact"],
    },
    run(args, ctx) {
      const fact = ctx.memory.remember(str(args.fact));
      return ok({ remembered: fact.text }, { say: `Nhớ rồi: ${fact.text}` });
    },
  },

  {
    name: "list_memory",
    description: "Xem những điều agent đang nhớ về nhóm này.",
    parameters: { type: "object", properties: {} },
    run(_a, ctx) {
      return ok(ctx.memory.facts().map((f) => ({ id: f.id, text: f.text })));
    },
  },

  {
    name: "forget",
    description: "Quên một điều đã nhớ.",
    parameters: {
      type: "object",
      properties: { fact: { type: "string", description: "Nội dung điều cần quên" } },
      required: ["fact"],
    },
    needsConfirm: () => true,
    describe: (args) => `Quên "${str(args.fact)}" nhé?`,
    run(args, ctx) {
      const needle = str(args.fact).toLowerCase();
      const target = ctx.memory
        .facts()
        .find((f) => f.text.toLowerCase().includes(needle));
      if (!target) return fail("Không nhớ điều đó nên không có gì để quên.");
      ctx.memory.forget(target.id);
      return ok({ forgot: target.text }, { say: `Quên rồi: ${target.text}` });
    },
  },
];

export const toolByName = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

/** Khai báo gửi cho Gemini — chỉ tên, mô tả, schema. */
export function toolDeclarations() {
  return AGENT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}
