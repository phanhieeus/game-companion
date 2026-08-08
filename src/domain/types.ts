/**
 * Kiểu dữ liệu cốt lõi — xem docs/product/scoring.md.
 *
 * Bất biến: điểm tổng KHÔNG lưu trực tiếp. Scoreboard luôn tính lại từ các
 * Round có status 'recorded'. Không có đường nào ghi thẳng vào total.
 */

export type SessionStatus = "active" | "ended";
export type PlayerStatus = "active" | "removed";
export type RoundStatus = "recorded" | "voided";
export type RoundSource = "voice" | "manual";

/** MVP chỉ hỗ trợ 'direct' — xem decision 0002. */
export interface ScoringConfig {
  mode: "direct";
  startingScore: number;
  zeroSum: boolean;
  allowNegative: boolean;
}

export interface Player {
  id: string;
  sessionId: string;
  name: string;
  seatNo?: number;
  status: PlayerStatus;
}

export interface ScoreEntry {
  id: string;
  roundId: string;
  playerId: string;
  delta: number;
}

/**
 * Nhật ký thay đổi của một ván — bất biến, chỉ thêm không sửa (ADR quyết định 8).
 *
 * Cho sửa trực tiếp từng ô mà không truy được ai sửa gì lúc nào thì mất luôn khả
 * năng giải quyết tranh cãi — đúng lý do bảng theo ván tồn tại. Log là điều kiện
 * để mở tính năng sửa, không phải tính năng phụ.
 */
export type RoundEventKind = "created" | "updated" | "voided" | "restored";

export interface RoundEventEntry {
  playerId: string;
  delta: number;
}

export interface RoundEvent {
  id: string;
  kind: RoundEventKind;
  at: string;
  source: RoundSource;
  /** Vắng khi kind = "created". */
  before?: RoundEventEntry[];
  /** Vắng khi kind = "voided". */
  after?: RoundEventEntry[];
}

export interface Round {
  id: string;
  sessionId: string;
  sequenceNo: number;
  status: RoundStatus;
  createdAt: string;
  source: RoundSource;
  entries: ScoreEntry[];
  /**
   * Nhật ký thay đổi. Dữ liệu localStorage cũ không có field này — mọi chỗ đọc
   * phải chịu được `undefined` (dùng `roundEvents()` trong scoring.ts).
   */
  events?: RoundEvent[];
  /** Chống ghi trùng khi STT/mạng lặp yêu cầu. */
  clientRequestId?: string;
}

export interface Session {
  id: string;
  name?: string;
  status: SessionStatus;
  scoringConfig: ScoringConfig;
  players: Player[];
  rounds: Round[];
  createdAt: string;
  endedAt?: string;
  /** Người đang cầm máy — để hiểu "tôi được bao nhiêu". */
  mePlayerId?: string;
  /** Xác nhận trước khi ghi. Mặc định bật; tắt được trong cài đặt. */
  confirmBeforeCommit: boolean;
}

export interface ScoreboardRow {
  playerId: string;
  name: string;
  total: number;
  rank: number;
}

export interface Scoreboard {
  rows: ScoreboardRow[];
  roundsPlayed: number;
}

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 5;

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  mode: "direct",
  startingScore: 0,
  zeroSum: true,
  allowNegative: true,
};
