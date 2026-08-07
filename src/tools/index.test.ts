import { beforeEach, describe, expect, it } from "vitest";
import { MemorySessionRepository } from "../repository/memoryRepository";
import { createTools, __resetIdCounter, type Tools } from "./index";

const PLAYERS = [
  { name: "Nam" },
  { name: "Hùng" },
  { name: "Lan" },
  { name: "Tú" },
];

function setup(): { tools: Tools; sessionId: string; ids: string[] } {
  const repo = new MemorySessionRepository();
  const tools = createTools(repo);
  const created = tools.create_session({ players: PLAYERS });
  if (!created.ok) throw new Error("setup failed");
  const sessionId = created.data.session_id;
  const ids = created.data.scoreboard.rows.map((r) => r.playerId);
  return { tools, sessionId, ids };
}

beforeEach(() => __resetIdCounter());

describe("create_session", () => {
  it("từ chối dưới 4 người", () => {
    const repo = new MemorySessionRepository();
    const tools = createTools(repo);
    const result = tools.create_session({ players: [{ name: "A" }, { name: "B" }] });
    expect(result.error?.code).toBe("TOO_FEW_PLAYERS");
  });

  it("từ chối quá 5 người", () => {
    const repo = new MemorySessionRepository();
    const tools = createTools(repo);
    const result = tools.create_session({
      players: [...PLAYERS, { name: "Minh" }, { name: "Sơn" }],
    });
    expect(result.error?.code).toBe("TOO_MANY_PLAYERS");
  });

  it("mặc định bật xác nhận trước khi ghi", () => {
    const { tools, sessionId } = setup();
    const off = tools.set_confirm_before_commit({
      session_id: sessionId,
      enabled: false,
    });
    expect(off.ok).toBe(true);
  });
});

describe("record_round", () => {
  it("ghi ván hợp lệ và cập nhật bảng điểm", () => {
    const { tools, sessionId, ids } = setup();
    const result = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 3 },
        { playerId: ids[1]!, delta: -1 },
        { playerId: ids[2]!, delta: -1 },
        { playerId: ids[3]!, delta: -1 },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.data?.scoreboard.roundsPlayed).toBe(1);
    expect(result.data?.scoreboard.rows[0]?.total).toBe(3);
  });

  it("không ghi trùng khi lặp cùng client_request_id", () => {
    const { tools, sessionId, ids } = setup();
    const entries = [
      { playerId: ids[0]!, delta: 3 },
      { playerId: ids[1]!, delta: -1 },
      { playerId: ids[2]!, delta: -1 },
      { playerId: ids[3]!, delta: -1 },
    ];
    const first = tools.record_round({
      session_id: sessionId,
      entries,
      client_request_id: "req-1",
    });
    const second = tools.record_round({
      session_id: sessionId,
      entries,
      client_request_id: "req-1",
    });

    expect(second.data?.round_id).toBe(first.data?.round_id);
    expect(second.data?.scoreboard.roundsPlayed).toBe(1);
  });

  it("từ chối ghi vào phiên đã kết thúc", () => {
    const { tools, sessionId, ids } = setup();
    tools.end_session({ session_id: sessionId });
    const result = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 1 },
        { playerId: ids[1]!, delta: -1 },
      ],
    });
    expect(result.error?.code).toBe("SESSION_ENDED");
  });
});

describe("undo_round", () => {
  it("mặc định hủy ván gần nhất và trả bảng điểm về trước đó", () => {
    const { tools, sessionId, ids } = setup();
    const round = (delta: number) => [
      { playerId: ids[0]!, delta },
      { playerId: ids[1]!, delta: -delta },
    ];

    tools.record_round({ session_id: sessionId, entries: round(3) });
    tools.record_round({ session_id: sessionId, entries: round(6) });

    const undone = tools.undo_round({ session_id: sessionId });
    expect(undone.ok).toBe(true);
    expect(undone.data?.scoreboard.roundsPlayed).toBe(1);
    expect(
      undone.data?.scoreboard.rows.find((r) => r.playerId === ids[0])?.total,
    ).toBe(3);
  });

  it("báo lỗi khi không còn ván nào để hủy", () => {
    const { tools, sessionId } = setup();
    expect(tools.undo_round({ session_id: sessionId }).error?.code).toBe(
      "NO_ROUND_TO_UNDO",
    );
  });

  it("không hủy hai lần cùng một ván", () => {
    const { tools, sessionId, ids } = setup();
    const recorded = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 2 },
        { playerId: ids[1]!, delta: -2 },
      ],
    });
    const roundId = recorded.data!.round_id;

    tools.undo_round({ session_id: sessionId, round_id: roundId });
    const again = tools.undo_round({ session_id: sessionId, round_id: roundId });
    expect(again.error?.code).toBe("NO_ROUND_TO_UNDO");
  });
});

describe("update_round", () => {
  it("sửa ván rồi tính lại, không sửa tay điểm tổng", () => {
    const { tools, sessionId, ids } = setup();
    const recorded = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 3 },
        { playerId: ids[1]!, delta: -3 },
      ],
    });

    const updated = tools.update_round({
      session_id: sessionId,
      round_id: recorded.data!.round_id,
      entries: [
        { playerId: ids[0]!, delta: 3 },
        { playerId: ids[1]!, delta: -1 },
        { playerId: ids[2]!, delta: -1 },
        { playerId: ids[3]!, delta: -1 },
      ],
    });

    expect(updated.ok).toBe(true);
    expect(
      updated.data?.scoreboard.rows.find((r) => r.playerId === ids[1])?.total,
    ).toBe(-1);
    expect(updated.data?.scoreboard.roundsPlayed).toBe(1);
  });

  it("báo lỗi khi ván không tồn tại", () => {
    const { tools, sessionId, ids } = setup();
    const result = tools.update_round({
      session_id: sessionId,
      round_id: "rnd_khong_co",
      entries: [
        { playerId: ids[0]!, delta: 1 },
        { playerId: ids[1]!, delta: -1 },
      ],
    });
    expect(result.error?.code).toBe("ROUND_NOT_FOUND");
  });
});

describe("truy vấn", () => {
  it("get_player_score trả tên, điểm và hạng", () => {
    const { tools, sessionId, ids } = setup();
    tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 5 },
        { playerId: ids[1]!, delta: -5 },
      ],
    });
    const score = tools.get_player_score({
      session_id: sessionId,
      player_id: ids[0]!,
    });
    expect(score.data?.total).toBe(5);
    expect(score.data?.rank).toBe(1);
  });

  it("get_history trả ván mới nhất trước và tôn trọng limit", () => {
    const { tools, sessionId, ids } = setup();
    for (let i = 1; i <= 3; i += 1) {
      tools.record_round({
        session_id: sessionId,
        entries: [
          { playerId: ids[0]!, delta: i },
          { playerId: ids[1]!, delta: -i },
        ],
      });
    }
    const history = tools.get_history({ session_id: sessionId, limit: 2 });
    expect(history.data?.rounds).toHaveLength(2);
    expect(history.data?.rounds[0]?.sequenceNo).toBe(3);
  });

  it("báo lỗi khi phiên không tồn tại", () => {
    const { tools } = setup();
    expect(tools.get_scoreboard({ session_id: "ses_khong_co" }).error?.code).toBe(
      "SESSION_NOT_FOUND",
    );
  });
});
