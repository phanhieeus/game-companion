/**
 * Sinh câu trả lời tiếng Việt. Ngắn, nghe được, đọc số rõ — người chơi đang
 * cầm bài chứ không nhìn màn hình (docs/product/overview.md, nguyên tắc UX).
 */

import type { Scoreboard } from "../../shared/types";

export function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** "Nam +3, Hùng −1, Lan −1, Tú −1" — dùng cho câu xác nhận trước khi ghi. */
export function describeEntries(
  entries: { name: string; delta: number }[],
): string {
  return entries
    .slice()
    .sort((a, b) => b.delta - a.delta)
    .map((e) => `${e.name} ${signed(e.delta)}`)
    .join(", ");
}

export function confirmRoundPrompt(
  entries: { name: string; delta: number }[],
): string {
  return `${describeEntries(entries)}. Ghi ván này nhé?`;
}

export function describeScoreboard(scoreboard: Scoreboard): string {
  if (scoreboard.rows.length === 0) return "Chưa có ai trong phiên.";
  if (scoreboard.roundsPlayed === 0) return "Chưa ghi ván nào, mọi người đều 0 điểm.";

  const [leader, ...rest] = scoreboard.rows;
  if (!leader) return "Chưa có dữ liệu.";

  const tiedWithLeader = rest.filter((r) => r.total === leader.total);
  const head =
    tiedWithLeader.length > 0
      ? `${[leader, ...tiedWithLeader].map((r) => r.name).join(" và ")} đang bằng nhau với ${leader.total} điểm`
      : `${leader.name} dẫn với ${leader.total} điểm`;

  const tail = rest
    .filter((r) => r.total !== leader.total)
    .map((r) => `${r.name} ${r.total}`)
    .join(", ");

  return tail ? `${head}. Kế đó ${tail}.` : `${head}.`;
}

export function describePlayerScore(
  name: string,
  total: number,
  rank: number,
  isMe: boolean,
): string {
  const who = isMe ? "Bạn" : name;
  const verb = isMe ? "đang có" : "được";
  return `${who} ${verb} ${total} điểm, hạng ${rank}.`;
}

export function describeRoundRecorded(
  sequenceNo: number,
  scoreboard: Scoreboard,
): string {
  const leader = scoreboard.rows[0];
  const suffix = leader ? ` ${leader.name} đang dẫn với ${leader.total} điểm.` : "";
  return `Xong ván ${sequenceNo}.${suffix}`;
}

export function describeRoundVoided(
  sequenceNo: number,
  scoreboard: Scoreboard,
): string {
  const standings = scoreboard.rows
    .map((r) => `${r.name} ${r.total}`)
    .join(", ");
  return `Đã hủy ván ${sequenceNo}. Bảng điểm quay lại: ${standings}.`;
}

export function describeHistory(
  rounds: { sequenceNo: number; entries: { name: string; delta: number }[] }[],
): string {
  if (rounds.length === 0) return "Chưa có ván nào.";
  return rounds
    .map((r) => `Ván ${r.sequenceNo}: ${describeEntries(r.entries)}`)
    .join(". ");
}

/** Nhận biết "ừ/đúng/ok" so với "không" khi đang chờ xác nhận. */
const YES = [
  "ừ", "ừa", "ờ", "uh", "um", "đúng", "phải", "ok", "okay", "oke",
  "được", "yes", "chuẩn", "vâng", "dạ", "ghi",
];
const NO = ["không", "ko", "khong", "sai", "no", "chưa", "đừng", "hủy", "thôi"];

export type Confirmation = "yes" | "no" | "unclear";

/**
 * Chỉ xét TỪ ĐẦU CÂU (hoặc cả câu chỉ có một từ).
 *
 * Quét cả câu thì hỏng: "Hùng trừ một thôi" là câu sửa lại, nhưng "thôi" cuối
 * câu là trợ từ nghĩa "chỉ", không phải từ chối. Đọc nhầm thành "no" sẽ nuốt
 * mất nội dung sửa. Trả "unclear" để lượt nói được hiểu lại như câu mới —
 * đúng với ví dụ D8 trong docs/product/conversation.md.
 */
export function readConfirmation(text: string): Confirmation {
  const normalized = text.toLowerCase().trim().replace(/[.,!?]/g, "");
  if (!normalized) return "unclear";

  const words = normalized.split(/\s+/);
  const first = words[0] ?? "";

  // "không" trước: "không đúng" là từ chối, không phải đồng ý.
  if (NO.includes(first)) return "no";
  if (YES.includes(first)) return "yes";
  return "unclear";
}
