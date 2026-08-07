/**
 * Scoring engine — thuần, không I/O. Xem docs/product/scoring.md.
 *
 * Đây là nơi duy nhất tính ra điểm tổng. Nếu cần sửa cách tính, sửa ở đây;
 * đừng rải logic ghi điểm ra chỗ khác (decision 0001).
 */

import type { Round, ScoreEntry, Scoreboard, ScoringConfig, Session } from "./types";
import { MAX_PLAYERS, MIN_PLAYERS } from "./types";
import type { Result } from "./errors";
import { err, ok } from "./errors";

/** Điểm của một người = startingScore + tổng delta các ván 'recorded'. */
export function computeScoreboard(session: Session): Scoreboard {
  const { startingScore } = session.scoringConfig;
  const active = session.players.filter((p) => p.status === "active");

  const totals = new Map<string, number>();
  for (const p of active) totals.set(p.id, startingScore);

  const recorded = session.rounds.filter((r) => r.status === "recorded");
  for (const round of recorded) {
    for (const entry of round.entries) {
      const current = totals.get(entry.playerId);
      // Ván cũ có thể chứa người đã bị xoá khỏi phiên — bỏ qua, không dựng lại.
      if (current === undefined) continue;
      totals.set(entry.playerId, current + entry.delta);
    }
  }

  const rows = active
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      total: totals.get(p.id) ?? startingScore,
      rank: 0,
    }))
    .sort((a, b) => b.total - a.total);

  // Đồng điểm = đồng hạng; hạng kế tiếp nhảy qua (1,2,2,4).
  let previousTotal: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    if (previousTotal !== null && row.total === previousTotal) {
      row.rank = previousRank;
    } else {
      row.rank = index + 1;
      previousRank = row.rank;
      previousTotal = row.total;
    }
  });

  return { rows, roundsPlayed: recorded.length };
}

export interface DraftEntry {
  playerId: string;
  delta: number;
}

/**
 * Kiểm tra một ván trước khi ghi.
 *
 * Ràng buộc zero-sum ở đây là lưới an toàn chính chống STT nghe nhầm số:
 * nếu tổng ≠ 0 thì gần như chắc chắn nghe sai, nên từ chối thay vì ghi bừa.
 */
export function validateRoundEntries(
  session: Session,
  entries: DraftEntry[],
): Result<DraftEntry[]> {
  if (entries.length === 0) {
    return err("EMPTY_ROUND", "Ván không có người chơi nào.");
  }

  const activeIds = new Set(
    session.players.filter((p) => p.status === "active").map((p) => p.id),
  );

  const seen = new Set<string>();
  for (const entry of entries) {
    if (!activeIds.has(entry.playerId)) {
      return err(
        "PLAYER_NOT_IN_SESSION",
        `Người chơi ${entry.playerId} không thuộc phiên này.`,
      );
    }
    if (seen.has(entry.playerId)) {
      return err(
        "DUPLICATE_PLAYER_IN_ROUND",
        `Người chơi ${entry.playerId} xuất hiện hai lần trong một ván.`,
      );
    }
    seen.add(entry.playerId);

    if (!Number.isFinite(entry.delta) || !Number.isInteger(entry.delta)) {
      return err("SUM_DELTA_NOT_ZERO", "Điểm phải là số nguyên.");
    }
  }

  const config = session.scoringConfig;

  if (config.zeroSum) {
    const sum = entries.reduce((acc, e) => acc + e.delta, 0);
    if (sum !== 0) {
      return err(
        "SUM_DELTA_NOT_ZERO",
        `Tổng điểm của ván phải bằng 0, đang là ${sum}.`,
      );
    }
  }

  if (!config.allowNegative) {
    const scoreboard = computeScoreboard(session);
    for (const entry of entries) {
      const row = scoreboard.rows.find((r) => r.playerId === entry.playerId);
      const next = (row?.total ?? config.startingScore) + entry.delta;
      if (next < 0) {
        return err(
          "NEGATIVE_NOT_ALLOWED",
          `Cấu hình không cho điểm âm; ${row?.name ?? entry.playerId} sẽ còn ${next}.`,
        );
      }
    }
  }

  return ok(entries);
}

export function validatePlayerCount(count: number): Result<number> {
  if (count < MIN_PLAYERS) {
    return err("TOO_FEW_PLAYERS", `Cần ít nhất ${MIN_PLAYERS} người chơi.`);
  }
  if (count > MAX_PLAYERS) {
    return err("TOO_MANY_PLAYERS", `Tối đa ${MAX_PLAYERS} người chơi.`);
  }
  return ok(count);
}

export function nextSequenceNo(rounds: Round[]): number {
  return rounds.reduce((max, r) => Math.max(max, r.sequenceNo), 0) + 1;
}

/** Ván gần nhất còn hiệu lực — mục tiêu mặc định của undo. */
export function latestRecordedRound(rounds: Round[]): Round | undefined {
  let latest: Round | undefined;
  for (const round of rounds) {
    if (round.status !== "recorded") continue;
    if (!latest || round.sequenceNo > latest.sequenceNo) latest = round;
  }
  return latest;
}

export function totalOf(entries: ScoreEntry[] | DraftEntry[]): number {
  return entries.reduce((acc, e) => acc + e.delta, 0);
}

export function describeConfig(config: ScoringConfig): string {
  const parts = [`nhập điểm trực tiếp`];
  if (config.zeroSum) parts.push("tổng mỗi ván = 0");
  if (config.startingScore !== 0) parts.push(`bắt đầu từ ${config.startingScore}`);
  return parts.join(", ");
}
