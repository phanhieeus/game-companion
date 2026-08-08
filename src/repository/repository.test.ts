import { describe, expect, it } from "vitest";
import { MemorySessionRepository } from "./memoryRepository";
import { createTools } from "../tools";

const PLAYERS = [
  { name: "Nam" },
  { name: "Hùng" },
  { name: "Lan" },
  { name: "Tú" },
];

describe("SessionRepository", () => {
  /**
   * Regression: repo từng giữ đúng tham chiếu caller đưa vào. Tool layer sửa
   * session tại chỗ, nên get() sau khi ghi trả về CÙNG một object — React coi
   * như state không đổi và không render lại, bảng điểm đứng im sau khi ghi điểm.
   */
  it("trả về tham chiếu MỚI sau mỗi lần ghi, để React nhận ra state đã đổi", () => {
    const repo = new MemorySessionRepository();
    const tools = createTools(repo);

    const created = tools.create_session({ players: PLAYERS });
    const sessionId = created.data!.session_id;
    const ids = created.data!.scoreboard.rows.map((r) => r.playerId);

    const before = repo.get(sessionId);
    tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 2 },
        { playerId: ids[1]!, delta: -2 },
      ],
    });
    const after = repo.get(sessionId);

    expect(after).not.toBe(before);
    expect(before?.rounds).toHaveLength(0);
    expect(after?.rounds).toHaveLength(1);
  });

  it("sửa object đã lấy ra không làm bẩn dữ liệu trong repo", () => {
    const repo = new MemorySessionRepository();
    const tools = createTools(repo);
    const created = tools.create_session({ players: PLAYERS });
    const sessionId = created.data!.session_id;

    const taken = repo.get(sessionId)!;
    taken.players[0]!.name = "BỊ SỬA BẬY";

    expect(repo.get(sessionId)?.players[0]?.name).toBe("Nam");
  });

  it("activeSession bỏ qua phiên đã kết thúc", () => {
    const repo = new MemorySessionRepository();
    const tools = createTools(repo);
    const created = tools.create_session({ players: PLAYERS });

    expect(repo.activeSession()?.id).toBe(created.data!.session_id);
    tools.end_session({ session_id: created.data!.session_id });
    expect(repo.activeSession()).toBeUndefined();
  });
});
