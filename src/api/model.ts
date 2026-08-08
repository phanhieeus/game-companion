/**
 * Tên gọn cho các kiểu sinh từ OpenAPI (ADR 17).
 *
 * `types.ts` là file máy sinh, đường dẫn trong đó dài và khó đọc
 * (`components["schemas"]["Session"]`). File này chỉ đặt lại tên — KHÔNG khai
 * lại hình dạng, nên vẫn đúng một nguồn sự thật là model Pydantic.
 */

import type { components } from "./types";

type S = components["schemas"];

export type Session = S["Session"];
export type Round = S["Round"];
export type RoundEvent = S["RoundEvent"];
export type Player = S["Player"];
export type Scoreboard = S["Scoreboard"];
export type ProposalRow = S["ProposalRow"];
export type SessionView = S["SessionView"];
export type AgentReply = S["AgentReply"];
export type AgentOutcome = AgentReply["outcome"];
export type RoundOrder = NonNullable<S["UiIntents"]["roundOrder"]>;

/** Một ô điểm đang gõ dở, trước khi thành `ScoreEntry` thật. */
export interface DraftEntry {
  playerId: string;
  delta: number;
}

/**
 * Đọc nhật ký của một ván, chịu được dữ liệu cũ chưa có field `events`.
 *
 * Thuần tuý đọc dữ liệu client đã có sẵn, nên không cần thêm một chuyến gọi API
 * chỉ để biết vẽ dấu ˟.
 */
export const roundEvents = (round: Round): RoundEvent[] => round.events ?? [];

/** Có từng bị sửa hoặc hủy chưa — quyết định hiện dấu trên hàng. */
export const wasModified = (round: Round): boolean =>
  roundEvents(round).some((e) => e.kind !== "created");
