import { describe, expect, it } from "vitest";
import { computeScoreboard, validateRoundEntries } from "./scoring.ts";
import type { Round, Session } from "../../shared/types.ts";
import { DEFAULT_SCORING_CONFIG } from "../../shared/types.ts";

function makeSession(rounds: Round[] = []): Session {
  return {
    id: "ses_1",
    status: "active",
    scoringConfig: { ...DEFAULT_SCORING_CONFIG },
    players: [
      { id: "p1", sessionId: "ses_1", name: "Nam", status: "active" },
      { id: "p2", sessionId: "ses_1", name: "Hùng", status: "active" },
      { id: "p3", sessionId: "ses_1", name: "Lan", status: "active" },
      { id: "p4", sessionId: "ses_1", name: "Tú", status: "active" },
    ],
    rounds,
    createdAt: "2026-08-08T00:00:00.000Z",
    confirmBeforeCommit: true,
  };
}

function makeRound(
  seq: number,
  deltas: Record<string, number>,
  status: "recorded" | "voided" = "recorded",
): Round {
  return {
    id: `rnd_${seq}`,
    sessionId: "ses_1",
    sequenceNo: seq,
    status,
    createdAt: "2026-08-08T00:00:00.000Z",
    source: "voice",
    entries: Object.entries(deltas).map(([playerId, delta], i) => ({
      id: `ent_${seq}_${i}`,
      roundId: `rnd_${seq}`,
      playerId,
      delta,
    })),
  };
}

describe("computeScoreboard", () => {
  it("bắt đầu ở startingScore khi chưa có ván nào", () => {
    const board = computeScoreboard(makeSession());
    expect(board.roundsPlayed).toBe(0);
    expect(board.rows.every((r) => r.total === 0)).toBe(true);
  });

  it("cộng dồn các ván recorded", () => {
    const session = makeSession([
      makeRound(1, { p1: 3, p2: -1, p3: -1, p4: -1 }),
      makeRound(2, { p1: 3, p2: -1, p3: -1, p4: -1 }),
    ]);
    const board = computeScoreboard(session);
    expect(board.roundsPlayed).toBe(2);
    expect(board.rows.find((r) => r.playerId === "p1")?.total).toBe(6);
    expect(board.rows.find((r) => r.playerId === "p2")?.total).toBe(-2);
  });

  it("bỏ qua ván voided — undo là tính lại, không sửa tay điểm tổng", () => {
    const session = makeSession([
      makeRound(1, { p1: 3, p2: -1, p3: -1, p4: -1 }),
      makeRound(2, { p1: 6, p2: -2, p3: -2, p4: -2 }, "voided"),
    ]);
    const board = computeScoreboard(session);
    expect(board.roundsPlayed).toBe(1);
    expect(board.rows.find((r) => r.playerId === "p1")?.total).toBe(3);
  });

  it("xếp hạng giảm dần, đồng điểm thì đồng hạng", () => {
    const session = makeSession([makeRound(1, { p1: 3, p2: 3, p3: -3, p4: -3 })]);
    const board = computeScoreboard(session);
    expect(board.rows.map((r) => r.rank)).toEqual([1, 1, 3, 3]);
  });

  it("không dựng lại người chơi đã bị xoá khỏi phiên", () => {
    const session = makeSession([makeRound(1, { p1: 3, p2: -1, p3: -1, p4: -1 })]);
    session.players[1]!.status = "removed";
    const board = computeScoreboard(session);
    expect(board.rows).toHaveLength(3);
    expect(board.rows.some((r) => r.playerId === "p2")).toBe(false);
  });
});

describe("validateRoundEntries", () => {
  it("chấp nhận ván có tổng bằng 0", () => {
    const result = validateRoundEntries(makeSession(), [
      { playerId: "p1", delta: 3 },
      { playerId: "p2", delta: -1 },
      { playerId: "p3", delta: -1 },
      { playerId: "p4", delta: -1 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("từ chối khi tổng khác 0 — lưới chống STT nghe nhầm số", () => {
    const result = validateRoundEntries(makeSession(), [
      { playerId: "p1", delta: 3 },
      { playerId: "p2", delta: -1 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SUM_DELTA_NOT_ZERO");
  });

  it("từ chối người không thuộc phiên", () => {
    const result = validateRoundEntries(makeSession(), [
      { playerId: "p1", delta: 1 },
      { playerId: "ghost", delta: -1 },
    ]);
    expect(result.error?.code).toBe("PLAYER_NOT_IN_SESSION");
  });

  it("từ chối khi một người xuất hiện hai lần trong một ván", () => {
    const result = validateRoundEntries(makeSession(), [
      { playerId: "p1", delta: 1 },
      { playerId: "p1", delta: -1 },
    ]);
    expect(result.error?.code).toBe("DUPLICATE_PLAYER_IN_ROUND");
  });

  it("từ chối ván rỗng", () => {
    expect(validateRoundEntries(makeSession(), []).error?.code).toBe("EMPTY_ROUND");
  });

  it("cho phép tổng khác 0 khi tắt zero_sum", () => {
    const session = makeSession();
    session.scoringConfig.zeroSum = false;
    const result = validateRoundEntries(session, [{ playerId: "p1", delta: 5 }]);
    expect(result.ok).toBe(true);
  });
});
