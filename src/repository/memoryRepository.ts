import type { Session } from "../domain/types";
import type { SessionRepository } from "./types";

/** Dùng trong test và làm fallback khi localStorage không khả dụng. */
export class MemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  save(session: Session): void {
    this.sessions.set(session.id, session);
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
