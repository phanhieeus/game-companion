import type { Session } from "../domain/types";
import type { SessionRepository } from "./types";

/** Dùng trong test và làm fallback khi localStorage không khả dụng. */
export class MemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();

  get(sessionId: string): Session | undefined {
    const stored = this.sessions.get(sessionId);
    return stored ? structuredClone(stored) : undefined;
  }

  save(session: Session): void {
    // Lưu bản sao, không giữ tham chiếu của caller.
    //
    // Tool layer sửa session tại chỗ (session.rounds.push(...)). Nếu repo giữ
    // đúng object đó thì get() trả về cùng một tham chiếu, React thấy state
    // không đổi và KHÔNG render lại — ghi điểm xong bảng điểm đứng im.
    this.sessions.set(session.id, structuredClone(session));
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  activeSession(): Session | undefined {
    return this.list().find((s) => s.status === "active");
  }
}
