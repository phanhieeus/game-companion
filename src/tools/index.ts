/**
 * Tool layer — hợp đồng ổn định. Xem docs/product/tools.md.
 *
 * Tên hàm giữ nguyên snake_case đúng như "tool" trong kiến trúc plugin tương
 * lai (decision 0001). Đừng đổi sang camelCase cho "hợp TypeScript" — sau này
 * chỉ cần register_tool() là xong, không phải viết lại business logic.
 *
 * Mọi thao tác ghi điểm đi qua đây, một điểm duy nhất, để sau gắn Event Bus.
 */

import type {
  Player,
  Round,
  RoundEvent,
  RoundEventEntry,
  RoundEventKind,
  RoundSource,
  Scoreboard,
  ScoringConfig,
  Session,
} from "../domain/types";
import { DEFAULT_SCORING_CONFIG, MAX_PLAYERS } from "../domain/types";
import type { Result } from "../domain/errors";
import { err, ok } from "../domain/errors";
import {
  computeScoreboard,
  describeAction,
  latestRecordedRound,
  nextRedoTarget,
  nextSequenceNo,
  nextUndoTarget,
  undoDepthOf,
  validatePlayerCount,
  validateRoundEntries,
  type DraftEntry,
  type TimelineItem,
} from "../domain/scoring";
import type { SessionRepository } from "../repository/types";

let idCounter = 0;
function newId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

/** Cho test đặt lại bộ đếm để id ổn định giữa các case. */
export function __resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Hai bộ điểm có giống hệt nhau không (không kể thứ tự).
 *
 * Dùng để bỏ qua lần sửa rỗng: mở ô ra xem rồi bấm Lưu mà không đổi gì thì
 * không nên sinh mục nhật ký, không nên đánh dấu ván là "đã sửa", và nhất là
 * không nên đẩy con trỏ undo — làm vậy sẽ xoá nhánh làm lại một cách vô cớ.
 */
function sameEntries(a: RoundEventEntry[], b: RoundEventEntry[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Map(a.map((e) => [e.playerId, e.delta]));
  for (const entry of b) {
    if (left.get(entry.playerId) !== entry.delta) return false;
  }
  return true;
}

/** Ảnh chụp điểm của một ván, để ghi vào nhật ký. */
function snapshot(round: Round): RoundEventEntry[] {
  return round.entries.map((e) => ({ playerId: e.playerId, delta: e.delta }));
}

/**
 * Ghi một mục vào nhật ký của ván.
 *
 * Nhật ký là bất biến: chỉ thêm, không bao giờ sửa hay xoá mục cũ. Đây là điều
 * kiện để mở tính năng sửa ô trực tiếp (ADR quyết định 8) — không có nó thì
 * "ván 3 sao khác lúc nãy" thành câu hỏi không trả lời được.
 */
function appendEvent(
  round: Round,
  kind: RoundEventKind,
  source: RoundSource,
  parts: {
    before?: RoundEventEntry[];
    after?: RoundEventEntry[];
    isUndo?: boolean;
    isRedo?: boolean;
  },
): void {
  const event: RoundEvent = {
    id: newId("evt"),
    kind,
    at: new Date().toISOString(),
    source,
    ...(parts.before ? { before: parts.before } : {}),
    ...(parts.after ? { after: parts.after } : {}),
    ...(parts.isUndo ? { isUndo: true } : {}),
    ...(parts.isRedo ? { isRedo: true } : {}),
  };
  // Dữ liệu cũ chưa có mảng events — tạo khi cần.
  round.events = [...(round.events ?? []), event];
}

/** Gán lại điểm của ván từ một ảnh chụp trong nhật ký. */
function restoreEntries(round: Round, entries: RoundEventEntry[]): void {
  round.entries = entries.map((e) => ({
    id: newId("ent"),
    roundId: round.id,
    playerId: e.playerId,
    delta: e.delta,
  }));
}

/** Đảo ngược một thao tác (bấm Hoàn tác). */
function applyInverse(round: Round, item: TimelineItem): void {
  const { event } = item;
  switch (event.kind) {
    case "created":
    case "restored":
      round.status = "voided";
      appendEvent(round, "voided", event.source, {
        before: snapshot(round),
        isUndo: true,
      });
      break;
    case "voided":
      round.status = "recorded";
      appendEvent(round, "restored", event.source, {
        after: snapshot(round),
        isUndo: true,
      });
      break;
    case "updated": {
      const before = snapshot(round);
      if (event.before) restoreEntries(round, event.before);
      appendEvent(round, "updated", event.source, {
        before,
        after: snapshot(round),
        isUndo: true,
      });
      break;
    }
  }
}

/** Làm lại một thao tác đã hoàn tác. */
function applyForward(round: Round, item: TimelineItem): void {
  const { event } = item;
  switch (event.kind) {
    case "created":
    case "restored":
      round.status = "recorded";
      if (event.after) restoreEntries(round, event.after);
      appendEvent(round, "restored", event.source, {
        after: snapshot(round),
        isRedo: true,
      });
      break;
    case "voided":
      round.status = "voided";
      appendEvent(round, "voided", event.source, {
        before: snapshot(round),
        isRedo: true,
      });
      break;
    case "updated": {
      const before = snapshot(round);
      if (event.after) restoreEntries(round, event.after);
      appendEvent(round, "updated", event.source, {
        before,
        after: snapshot(round),
        isRedo: true,
      });
      break;
    }
  }
}

export interface Tools {
  create_session(input: {
    name?: string;
    scoring_config?: Partial<ScoringConfig>;
    players: { name: string; seat_no?: number }[];
    me_player_name?: string;
  }): Result<{ session_id: string; scoreboard: Scoreboard }>;

  add_player(input: {
    session_id: string;
    name: string;
    seat_no?: number;
  }): Result<{ player_id: string }>;

  remove_player(input: {
    session_id: string;
    player_id: string;
  }): Result<{ ok: true }>;

  update_scoring_config(input: {
    session_id: string;
    scoring_config: Partial<ScoringConfig>;
  }): Result<{ ok: true }>;

  set_confirm_before_commit(input: {
    session_id: string;
    enabled: boolean;
  }): Result<{ ok: true }>;

  record_round(input: {
    session_id: string;
    entries: DraftEntry[];
    client_request_id?: string;
    source?: "voice" | "manual";
  }): Result<{ round_id: string; scoreboard: Scoreboard }>;

  update_round(input: {
    session_id: string;
    round_id: string;
    entries: DraftEntry[];
    source?: RoundSource;
  }): Result<{ scoreboard: Scoreboard }>;

  undo_round(input: {
    session_id: string;
    round_id?: string;
    source?: RoundSource;
  }): Result<{ voided_round_id: string; scoreboard: Scoreboard }>;

  /** Hoàn tác thao tác gần nhất chưa bị hoàn tác. */
  undo_last(input: { session_id: string }): Result<{
    label: string;
    scoreboard: Scoreboard;
  }>;

  /** Làm lại thao tác vừa bị hoàn tác. */
  redo_last(input: { session_id: string }): Result<{
    label: string;
    scoreboard: Scoreboard;
  }>;

  /** Nhãn cho hai nút, null nghĩa là nút phải bị vô hiệu hoá. */
  get_undo_state(input: { session_id: string }): Result<{
    undo: string | null;
    redo: string | null;
  }>;

  /** Nhật ký thêm/sửa/xóa của một ván — xem ADR quyết định 8. */
  get_round_events(input: {
    session_id: string;
    round_id: string;
  }): Result<{ events: RoundEvent[] }>;

  get_scoreboard(input: { session_id: string }): Result<Scoreboard>;

  get_player_score(input: {
    session_id: string;
    player_id: string;
  }): Result<{ name: string; total: number; rank: number }>;

  get_history(input: {
    session_id: string;
    limit?: number;
  }): Result<{ rounds: Round[] }>;

  end_session(input: { session_id: string }): Result<{ scoreboard: Scoreboard }>;
}

export function createTools(repo: SessionRepository): Tools {
  /** Lấy phiên và chặn thao tác ghi lên phiên đã kết thúc. */
  function loadSession(
    sessionId: string,
    forWrite: boolean,
  ): Result<Session> {
    const session = repo.get(sessionId);
    if (!session) {
      return err("SESSION_NOT_FOUND", `Không tìm thấy phiên ${sessionId}.`);
    }
    if (forWrite && session.status === "ended") {
      return err("SESSION_ENDED", "Phiên đã kết thúc, không ghi thêm được.");
    }
    return ok(session);
  }

  return {
    create_session({ name, scoring_config, players, me_player_name }) {
      const countCheck = validatePlayerCount(players.length);
      if (!countCheck.ok) return countCheck as Result<never>;

      const sessionId = newId("ses");
      const playerRecords: Player[] = players.map((p, index) => ({
        id: newId("ply"),
        sessionId,
        name: p.name.trim(),
        ...(p.seat_no !== undefined ? { seatNo: p.seat_no } : { seatNo: index + 1 }),
        status: "active" as const,
      }));

      const me = me_player_name
        ? playerRecords.find(
            (p) => p.name.toLowerCase() === me_player_name.trim().toLowerCase(),
          )
        : undefined;

      const session: Session = {
        id: sessionId,
        ...(name ? { name } : {}),
        status: "active",
        scoringConfig: { ...DEFAULT_SCORING_CONFIG, ...scoring_config },
        players: playerRecords,
        rounds: [],
        createdAt: new Date().toISOString(),
        ...(me ? { mePlayerId: me.id } : {}),
        confirmBeforeCommit: true,
      };

      repo.save(session);
      return ok({ session_id: sessionId, scoreboard: computeScoreboard(session) });
    },

    add_player({ session_id, name, seat_no }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const activeCount = session.players.filter(
        (p) => p.status === "active",
      ).length;
      if (activeCount >= MAX_PLAYERS) {
        return err("TOO_MANY_PLAYERS", `Tối đa ${MAX_PLAYERS} người chơi.`);
      }

      const player: Player = {
        id: newId("ply"),
        sessionId: session.id,
        name: name.trim(),
        ...(seat_no !== undefined ? { seatNo: seat_no } : { seatNo: activeCount + 1 }),
        status: "active",
      };
      session.players.push(player);
      repo.save(session);
      return ok({ player_id: player.id });
    },

    remove_player({ session_id, player_id }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const player = session.players.find((p) => p.id === player_id);
      if (!player || player.status !== "active") {
        return err(
          "PLAYER_NOT_IN_SESSION",
          `Người chơi ${player_id} không thuộc phiên này.`,
        );
      }

      // Đánh dấu removed, không xoá — các ván cũ vẫn phải tính đúng như đã ghi.
      player.status = "removed";
      repo.save(session);
      return ok({ ok: true as const });
    },

    update_scoring_config({ session_id, scoring_config }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      // Ván đã ghi không hồi tố — xem docs/product/open-questions.md.
      session.scoringConfig = { ...session.scoringConfig, ...scoring_config };
      repo.save(session);
      return ok({ ok: true as const });
    },

    set_confirm_before_commit({ session_id, enabled }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;
      session.confirmBeforeCommit = enabled;
      repo.save(session);
      return ok({ ok: true as const });
    },

    record_round({ session_id, entries, client_request_id, source }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      // Idempotency: cùng client_request_id chỉ tạo một Round.
      if (client_request_id) {
        const existing = session.rounds.find(
          (r) => r.clientRequestId === client_request_id,
        );
        if (existing) {
          return ok({
            round_id: existing.id,
            scoreboard: computeScoreboard(session),
          });
        }
      }

      const validated = validateRoundEntries(session, entries);
      if (!validated.ok) return validated as Result<never>;

      const roundId = newId("rnd");
      const round: Round = {
        id: roundId,
        sessionId: session.id,
        sequenceNo: nextSequenceNo(session.rounds),
        status: "recorded",
        createdAt: new Date().toISOString(),
        source: source ?? "voice",
        entries: validated.data.map((e) => ({
          id: newId("ent"),
          roundId,
          playerId: e.playerId,
          delta: e.delta,
        })),
        ...(client_request_id ? { clientRequestId: client_request_id } : {}),
      };
      appendEvent(round, "created", round.source, { after: snapshot(round) });

      session.rounds.push(round);
      session.undoDepth = 0;
      repo.save(session);
      return ok({ round_id: roundId, scoreboard: computeScoreboard(session) });
    },

    update_round({ session_id, round_id, entries, source }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const round = session.rounds.find((r) => r.id === round_id);
      if (!round) {
        return err("ROUND_NOT_FOUND", `Không tìm thấy ván ${round_id}.`);
      }

      const validated = validateRoundEntries(session, entries);
      if (!validated.ok) return validated as Result<never>;

      const before = snapshot(round);
      const wasVoided = round.status === "voided";

      // Sửa rỗng: điểm y hệt VÀ ván vẫn đang hiệu lực → không có gì để ghi.
      // Trả về thành công để UI đóng ô sửa như bình thường, nhưng không đụng
      // vào nhật ký lẫn con trỏ undo.
      const next = validated.data.map((e) => ({
        playerId: e.playerId,
        delta: e.delta,
      }));
      if (!wasVoided && sameEntries(before, next)) {
        return ok({ scoreboard: computeScoreboard(session) });
      }

      round.entries = validated.data.map((e) => ({
        id: newId("ent"),
        roundId: round.id,
        playerId: e.playerId,
        delta: e.delta,
      }));
      // Sửa một ván đã hủy thì coi như khôi phục lại nó.
      round.status = "recorded";

      appendEvent(round, wasVoided ? "restored" : "updated", source ?? "manual", {
        before,
        after: snapshot(round),
      });
      session.undoDepth = 0;

      repo.save(session);
      return ok({ scoreboard: computeScoreboard(session) });
    },

    undo_round({ session_id, round_id, source }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const target = round_id
        ? session.rounds.find((r) => r.id === round_id)
        : latestRecordedRound(session.rounds);

      if (!target) {
        return err("NO_ROUND_TO_UNDO", "Không còn ván nào để hủy.");
      }
      if (target.status === "voided") {
        return err("NO_ROUND_TO_UNDO", `Ván ${target.sequenceNo} đã bị hủy rồi.`);
      }

      // Hủy = đánh dấu rồi tính lại. Không bao giờ sửa tay điểm tổng.
      const before = snapshot(target);
      target.status = "voided";
      appendEvent(target, "voided", source ?? "manual", { before });
      session.undoDepth = 0;

      repo.save(session);
      return ok({
        voided_round_id: target.id,
        scoreboard: computeScoreboard(session),
      });
    },

    undo_last({ session_id }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const target = nextUndoTarget(session);
      if (!target) return err("NO_ROUND_TO_UNDO", "Không còn gì để hoàn tác.");

      const round = session.rounds.find((r) => r.id === target.round.id);
      if (!round) return err("ROUND_NOT_FOUND", "Không tìm thấy ván.");

      applyInverse(round, target);
      session.undoDepth = undoDepthOf(session) + 1;
      repo.save(session);

      return ok({
        label: describeAction("Đã hoàn tác", target),
        scoreboard: computeScoreboard(session),
      });
    },

    redo_last({ session_id }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const target = nextRedoTarget(session);
      if (!target) return err("NO_ROUND_TO_UNDO", "Không còn gì để làm lại.");

      const round = session.rounds.find((r) => r.id === target.round.id);
      if (!round) return err("ROUND_NOT_FOUND", "Không tìm thấy ván.");

      applyForward(round, target);
      session.undoDepth = Math.max(0, undoDepthOf(session) - 1);
      repo.save(session);

      return ok({
        label: describeAction("Đã làm lại", target),
        scoreboard: computeScoreboard(session),
      });
    },

    get_undo_state({ session_id }) {
      const loaded = loadSession(session_id, false);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      const undo = nextUndoTarget(session);
      const redo = nextRedoTarget(session);
      return ok({
        undo: undo ? describeAction("Hoàn tác", undo) : null,
        redo: redo ? describeAction("Làm lại", redo) : null,
      });
    },

    get_round_events({ session_id, round_id }) {
      const loaded = loadSession(session_id, false);
      if (!loaded.ok) return loaded as Result<never>;

      const round = loaded.data.rounds.find((r) => r.id === round_id);
      if (!round) {
        return err("ROUND_NOT_FOUND", `Không tìm thấy ván ${round_id}.`);
      }
      return ok({ events: round.events ?? [] });
    },

    get_scoreboard({ session_id }) {
      const loaded = loadSession(session_id, false);
      if (!loaded.ok) return loaded as Result<never>;
      return ok(computeScoreboard(loaded.data));
    },

    get_player_score({ session_id, player_id }) {
      const loaded = loadSession(session_id, false);
      if (!loaded.ok) return loaded as Result<never>;

      const scoreboard = computeScoreboard(loaded.data);
      const row = scoreboard.rows.find((r) => r.playerId === player_id);
      if (!row) {
        return err(
          "PLAYER_NOT_IN_SESSION",
          `Người chơi ${player_id} không thuộc phiên này.`,
        );
      }
      return ok({ name: row.name, total: row.total, rank: row.rank });
    },

    get_history({ session_id, limit }) {
      const loaded = loadSession(session_id, false);
      if (!loaded.ok) return loaded as Result<never>;

      const rounds = [...loaded.data.rounds].sort(
        (a, b) => b.sequenceNo - a.sequenceNo,
      );
      return ok({ rounds: limit ? rounds.slice(0, limit) : rounds });
    },

    end_session({ session_id }) {
      const loaded = loadSession(session_id, true);
      if (!loaded.ok) return loaded as Result<never>;
      const session = loaded.data;

      session.status = "ended";
      session.endedAt = new Date().toISOString();
      repo.save(session);
      return ok({ scoreboard: computeScoreboard(session) });
    },
  };
}
