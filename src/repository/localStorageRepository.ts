import type { Session } from "../domain/types";
import type { SessionRepository } from "./types";

const STORAGE_KEY = "game-companion:sessions:v1";

/** Mở lại app vẫn còn phiên đang chơi (câu hỏi mở số 4). */
export class LocalStorageSessionRepository implements SessionRepository {
  private cache: Map<string, Session> | null = null;

  private load(): Map<string, Session> {
    if (this.cache) return this.cache;

    const map = new Map<string, Session>();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Session[];
        for (const session of parsed) map.set(session.id, session);
      }
    } catch {
      // Dữ liệu hỏng thì bắt đầu lại còn hơn là crash cả app giữa ván bài.
    }
    this.cache = map;
    return map;
  }

  private flush(): void {
    if (!this.cache) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...this.cache.values()]),
      );
    } catch {
      // Hết dung lượng hoặc chế độ riêng tư — giữ trong bộ nhớ để phiên hiện
      // tại vẫn chơi tiếp được.
    }
  }

  get(sessionId: string): Session | undefined {
    return this.load().get(sessionId);
  }

  save(session: Session): void {
    this.load().set(session.id, session);
    this.flush();
  }

  list(): Session[] {
    return [...this.load().values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  delete(sessionId: string): void {
    this.load().delete(sessionId);
    this.flush();
  }

  activeSession(): Session | undefined {
    return this.list().find((s) => s.status === "active");
  }
}
