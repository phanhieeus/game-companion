import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Session } from "../../shared/types.ts";
import type { SessionRepository } from "./types.ts";

/**
 * Lưu phiên ra một file JSON trên đĩa (ADR 14).
 *
 * Một máy, một người ghi, vài chục phiên — ghi nguyên khối là đủ, và file đọc
 * được bằng mắt khi cần soi. Đổi sang CSDL sau chỉ phải viết thêm một bản của
 * interface này, không đụng scoring hay tool layer (decision 0001).
 *
 * Giữ toàn bộ dữ liệu trong RAM và ghi cả file mỗi lần `save`. Với quy mô này
 * thì rẻ hơn nhiều so với việc nghĩ ra một định dạng ghi từng phần, mà lại
 * không có lớp trạng thái thứ hai để lệch nhau.
 */
export class FileSessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();
  private readonly path: string;

  // Gán tường minh chứ không dùng parameter property: Node chạy .ts bằng cách
  // XOÁ phần kiểu đi, mà parameter property thì sinh ra code — nên không xoá
  // được, và server không khởi động nổi.
  constructor(path = join(process.cwd(), "data/sessions.json")) {
    this.path = path;
    this.load();
  }

  /**
   * File hỏng thì khởi động sạch chứ không sập.
   *
   * Đây là dữ liệu ván bài của một buổi chơi, không phải sổ sách ngân hàng. Máy
   * chủ không lên được vì một file JSON lỗi là hỏng nặng hơn nhiều so với mất
   * lịch sử — mà mất thì người dùng thấy ngay và nhập lại được.
   */
  private load(): void {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as Session[];
      if (!Array.isArray(parsed)) return;
      for (const session of parsed) {
        if (session?.id) this.sessions.set(session.id, session);
      }
    } catch {
      // Chưa có file (lần chạy đầu), hoặc file rách — cả hai đều bắt đầu rỗng.
    }
  }

  /**
   * Ghi ra file tạm rồi đổi tên đè lên.
   *
   * `rename` trong cùng một filesystem là thao tác nguyên tử, nên tắt máy giữa
   * chừng thì file cũ vẫn còn nguyên. Ghi thẳng đè lên thì có một khoảnh khắc
   * file chỉ có một nửa nội dung — mất sạch lịch sử vì một lần Ctrl-C không
   * đúng lúc.
   */
  private flush(): void {
    const payload = JSON.stringify([...this.sessions.values()], null, 2);
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, payload, "utf8");
    renameSync(temp, this.path);
  }

  get(sessionId: string): Session | undefined {
    const stored = this.sessions.get(sessionId);
    return stored ? structuredClone(stored) : undefined;
  }

  save(session: Session): void {
    // Bản sao, không giữ tham chiếu của caller — xem repository/types.ts.
    this.sessions.set(session.id, structuredClone(session));
    this.flush();
  }

  list(): Session[] {
    return [...this.sessions.values()]
      .map((s) => structuredClone(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.flush();
  }

  activeSession(): Session | undefined {
    return this.list().find((s) => s.status === "active");
  }
}
