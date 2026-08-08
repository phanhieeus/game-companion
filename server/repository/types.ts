/**
 * Repository tách khỏi logic tính điểm (decision 0001) — đổi localStorage sang
 * SQLite/server sau này không phải sửa scoring engine hay tool layer.
 *
 * Đây là VALUE STORE: get() trả bản sao, save() lưu bản sao. Không bao giờ chia
 * sẻ tham chiếu với caller. Tool layer sửa session tại chỗ, nên nếu chia sẻ
 * tham chiếu thì get() sau khi ghi trả về đúng object cũ, React không thấy state
 * đổi và bảng điểm đứng im sau khi ghi điểm. Xem repository.test.ts.
 */

import type { Session } from "../../shared/types.ts";

export interface SessionRepository {
  /** Trả về bản sao — sửa nó không ảnh hưởng dữ liệu đã lưu. */
  get(sessionId: string): Session | undefined;
  /** Lưu bản sao — giữ lại tham chiếu của caller là sai. */
  save(session: Session): void;
  list(): Session[];
  delete(sessionId: string): void;
  /** Phiên đang chơi gần nhất — để mở lại app là tiếp tục được. */
  activeSession(): Session | undefined;
}
