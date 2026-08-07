/**
 * Repository tách khỏi logic tính điểm (decision 0001) — đổi localStorage sang
 * SQLite/server sau này không phải sửa scoring engine hay tool layer.
 */

import type { Session } from "../domain/types";

export interface SessionRepository {
  get(sessionId: string): Session | undefined;
  save(session: Session): void;
  list(): Session[];
  delete(sessionId: string): void;
  /** Phiên đang chơi gần nhất — để mở lại app là tiếp tục được. */
  activeSession(): Session | undefined;
}
