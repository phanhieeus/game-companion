import { beforeEach, describe, expect, it } from "vitest";
import { MemorySessionRepository } from "../repository/memoryRepository.ts";
import { createTools, __resetIdCounter, type Tools } from "./index.ts";

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

describe("nhật ký thay đổi (audit log)", () => {
  it("ghi ván tạo mục 'created' kèm ảnh chụp sau", () => {
    const { tools, sessionId, ids } = setup();
    const recorded = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 3 },
        { playerId: ids[1]!, delta: -3 },
      ],
      source: "voice",
    });

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: recorded.data!.round_id,
    }).data!.events;

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("created");
    expect(events[0]!.source).toBe("voice");
    expect(events[0]!.before).toBeUndefined();
    expect(events[0]!.after).toHaveLength(2);
  });

  it("sửa ván ghi 'updated' kèm cả trước lẫn sau", () => {
    const { tools, sessionId, ids } = setup();
    const recorded = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 3 },
        { playerId: ids[1]!, delta: -3 },
      ],
    });

    tools.update_round({
      session_id: sessionId,
      round_id: recorded.data!.round_id,
      entries: [
        { playerId: ids[0]!, delta: 5 },
        { playerId: ids[1]!, delta: -5 },
      ],
      source: "manual",
    });

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: recorded.data!.round_id,
    }).data!.events;

    expect(events.map((e) => e.kind)).toEqual(["created", "updated"]);
    const updated = events[1]!;
    expect(updated.before!.find((e) => e.playerId === ids[0])!.delta).toBe(3);
    expect(updated.after!.find((e) => e.playerId === ids[0])!.delta).toBe(5);
  });

  it("hủy ván ghi 'voided', sửa lại ván đã hủy ghi 'restored'", () => {
    const { tools, sessionId, ids } = setup();
    const entries = [
      { playerId: ids[0]!, delta: 2 },
      { playerId: ids[1]!, delta: -2 },
    ];
    const recorded = tools.record_round({ session_id: sessionId, entries });
    const roundId = recorded.data!.round_id;

    tools.undo_round({ session_id: sessionId, round_id: roundId });
    tools.update_round({ session_id: sessionId, round_id: roundId, entries });

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: roundId,
    }).data!.events;

    expect(events.map((e) => e.kind)).toEqual(["created", "voided", "restored"]);
    // "voided" ghi lại điểm trước khi hủy, không có "sau" vì ván bị bỏ.
    expect(events[1]!.before).toHaveLength(2);
    expect(events[1]!.after).toBeUndefined();
  });

  it("nhật ký chỉ thêm, không bao giờ mất mục cũ", () => {
    const { tools, sessionId, ids } = setup();
    const entries = (d: number) => [
      { playerId: ids[0]!, delta: d },
      { playerId: ids[1]!, delta: -d },
    ];
    const recorded = tools.record_round({
      session_id: sessionId,
      entries: entries(1),
    });
    const roundId = recorded.data!.round_id;

    for (const d of [2, 3, 4]) {
      tools.update_round({ session_id: sessionId, round_id: roundId, entries: entries(d) });
    }

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: roundId,
    }).data!.events;
    expect(events).toHaveLength(4);
    expect(events[0]!.kind).toBe("created");
  });

  /**
   * Regression: localStorage của người dùng đã có phiên ghi từ TRƯỚC khi audit
   * log tồn tại. Những ván đó không có field `events` — đọc thẳng là nổ app.
   */
  it("chịu được ván cũ chưa có field events", () => {
    const repo = new MemorySessionRepository();
    const tools = createTools(repo);
    const created = tools.create_session({ players: PLAYERS });
    const sessionId = created.data!.session_id;
    const ids = created.data!.scoreboard.rows.map((r) => r.playerId);

    const recorded = tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 2 },
        { playerId: ids[1]!, delta: -2 },
      ],
    });

    // Mô phỏng dữ liệu cũ: xoá hẳn field events khỏi bản lưu.
    const stored = repo.get(sessionId)!;
    for (const round of stored.rounds) delete round.events;
    repo.save(stored);

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: recorded.data!.round_id,
    });
    expect(events.ok).toBe(true);
    expect(events.data!.events).toEqual([]);

    // Và vẫn sửa được bình thường sau đó.
    const updated = tools.update_round({
      session_id: sessionId,
      round_id: recorded.data!.round_id,
      entries: [
        { playerId: ids[0]!, delta: 4 },
        { playerId: ids[1]!, delta: -4 },
      ],
    });
    expect(updated.ok).toBe(true);
  });
});

describe("hoàn tác / làm lại", () => {
  const pair = (ids: string[], d: number) => [
    { playerId: ids[0]!, delta: d },
    { playerId: ids[1]!, delta: -d },
  ];

  it("hoàn tác việc thêm ván thì ván biến mất khỏi bảng điểm", () => {
    const { tools, sessionId, ids } = setup();
    tools.record_round({ session_id: sessionId, entries: pair(ids, 3) });
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(1);

    const undone = tools.undo_last({ session_id: sessionId });
    expect(undone.ok).toBe(true);
    expect(undone.data!.label).toContain("thêm ván 1");
    expect(undone.data!.scoreboard.roundsPlayed).toBe(0);
  });

  it("làm lại đưa ván trở về", () => {
    const { tools, sessionId, ids } = setup();
    tools.record_round({ session_id: sessionId, entries: pair(ids, 3) });
    tools.undo_last({ session_id: sessionId });

    const redone = tools.redo_last({ session_id: sessionId });
    expect(redone.ok).toBe(true);
    expect(redone.data!.scoreboard.roundsPlayed).toBe(1);
    expect(
      redone.data!.scoreboard.rows.find((r) => r.playerId === ids[0])?.total,
    ).toBe(3);
  });

  it("hoàn tác việc sửa thì điểm quay lại giá trị cũ", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: pair(ids, 3) });
    tools.update_round({
      session_id: sessionId,
      round_id: rec.data!.round_id,
      entries: pair(ids, 9),
    });
    expect(
      tools.get_scoreboard({ session_id: sessionId }).data!.rows.find(
        (r) => r.playerId === ids[0],
      )?.total,
    ).toBe(9);

    const undone = tools.undo_last({ session_id: sessionId });
    expect(
      undone.data!.scoreboard.rows.find((r) => r.playerId === ids[0])?.total,
    ).toBe(3);
  });

  it("lùi nhiều bước rồi tiến lại nhiều bước", () => {
    const { tools, sessionId, ids } = setup();
    for (const d of [1, 2, 3]) {
      tools.record_round({ session_id: sessionId, entries: pair(ids, d) });
    }
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(3);

    tools.undo_last({ session_id: sessionId });
    tools.undo_last({ session_id: sessionId });
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(1);

    tools.redo_last({ session_id: sessionId });
    tools.redo_last({ session_id: sessionId });
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(3);
  });

  it("hoàn tác nhiều lần không tự hoàn tác chính nó", () => {
    const { tools, sessionId, ids } = setup();
    tools.record_round({ session_id: sessionId, entries: pair(ids, 1) });
    tools.record_round({ session_id: sessionId, entries: pair(ids, 2) });

    tools.undo_last({ session_id: sessionId });
    tools.undo_last({ session_id: sessionId });
    // Đã lùi hết hai thao tác — không được quay ngược thành redo.
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(0);
    expect(tools.undo_last({ session_id: sessionId }).error?.code).toBe(
      "NO_ROUND_TO_UNDO",
    );
  });

  /** Giống mọi trình soạn thảo: làm việc mới thì mất nhánh redo. */
  it("thao tác mới sau khi hoàn tác thì bỏ nhánh làm lại", () => {
    const { tools, sessionId, ids } = setup();
    tools.record_round({ session_id: sessionId, entries: pair(ids, 1) });
    tools.undo_last({ session_id: sessionId });
    expect(tools.get_undo_state({ session_id: sessionId }).data!.redo).not.toBeNull();

    tools.record_round({ session_id: sessionId, entries: pair(ids, 7) });
    expect(tools.get_undo_state({ session_id: sessionId }).data!.redo).toBeNull();
  });

  it("get_undo_state trả nhãn có nghĩa, null khi không dùng được", () => {
    const { tools, sessionId, ids } = setup();
    let state = tools.get_undo_state({ session_id: sessionId }).data!;
    expect(state.undo).toBeNull();
    expect(state.redo).toBeNull();

    tools.record_round({ session_id: sessionId, entries: pair(ids, 4) });
    state = tools.get_undo_state({ session_id: sessionId }).data!;
    expect(state.undo).toBe("Hoàn tác thêm ván 1");
    expect(state.redo).toBeNull();

    tools.undo_last({ session_id: sessionId });
    state = tools.get_undo_state({ session_id: sessionId }).data!;
    expect(state.redo).toBe("Làm lại thêm ván 1");
  });

  it("hoàn tác việc xóa thì ván sống lại", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: pair(ids, 5) });
    tools.undo_round({ session_id: sessionId, round_id: rec.data!.round_id });
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(0);

    const undone = tools.undo_last({ session_id: sessionId });
    expect(undone.data!.label).toContain("xóa ván 1");
    expect(undone.data!.scoreboard.roundsPlayed).toBe(1);
  });

  it("nhật ký vẫn ghi lại cả lần hoàn tác", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: pair(ids, 2) });
    tools.undo_last({ session_id: sessionId });

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: rec.data!.round_id,
    }).data!.events;

    expect(events).toHaveLength(2);
    expect(events[1]!.isUndo).toBe(true);
  });
});

describe("sửa rỗng (không đổi gì)", () => {
  const four = (ids: string[]) => [
    { playerId: ids[0]!, delta: 3 },
    { playerId: ids[1]!, delta: -1 },
    { playerId: ids[2]!, delta: -1 },
    { playerId: ids[3]!, delta: -1 },
  ];

  it("lưu y nguyên thì KHÔNG sinh mục nhật ký", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: four(ids) });
    const roundId = rec.data!.round_id;

    const saved = tools.update_round({
      session_id: sessionId,
      round_id: roundId,
      entries: four(ids),
    });
    expect(saved.ok).toBe(true);

    const events = tools.get_round_events({
      session_id: sessionId,
      round_id: roundId,
    }).data!.events;
    expect(events.map((e) => e.kind)).toEqual(["created"]);
  });

  it("thứ tự khác nhau vẫn tính là không đổi", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: four(ids) });
    const roundId = rec.data!.round_id;

    tools.update_round({
      session_id: sessionId,
      round_id: roundId,
      entries: [...four(ids)].reverse(),
    });

    expect(
      tools.get_round_events({ session_id: sessionId, round_id: roundId }).data!
        .events,
    ).toHaveLength(1);
  });

  it("sửa rỗng KHÔNG xoá nhánh làm lại", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: four(ids) });
    tools.record_round({
      session_id: sessionId,
      entries: [
        { playerId: ids[0]!, delta: 5 },
        { playerId: ids[1]!, delta: -5 },
      ],
    });
    tools.undo_last({ session_id: sessionId });
    expect(tools.get_undo_state({ session_id: sessionId }).data!.redo).not.toBeNull();

    // Mở ván 1 ra rồi lưu y nguyên — không phải thao tác mới, nên redo còn nguyên.
    tools.update_round({
      session_id: sessionId,
      round_id: rec.data!.round_id,
      entries: four(ids),
    });
    expect(tools.get_undo_state({ session_id: sessionId }).data!.redo).not.toBeNull();
  });

  it("đổi dù chỉ một điểm thì VẪN ghi nhật ký", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: four(ids) });
    const roundId = rec.data!.round_id;

    tools.update_round({
      session_id: sessionId,
      round_id: roundId,
      entries: [
        { playerId: ids[0]!, delta: 3 },
        { playerId: ids[1]!, delta: -3 },
        { playerId: ids[2]!, delta: 1 },
        { playerId: ids[3]!, delta: -1 },
      ],
    });

    expect(
      tools.get_round_events({ session_id: sessionId, round_id: roundId }).data!
        .events.map((e) => e.kind),
    ).toEqual(["created", "updated"]);
  });

  /** Ván đang bị xóa thì lưu lại là KHÔI PHỤC, dù điểm y hệt. */
  it("ván đã xóa: lưu y nguyên vẫn tính là khôi phục", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: four(ids) });
    const roundId = rec.data!.round_id;
    tools.undo_round({ session_id: sessionId, round_id: roundId });

    tools.update_round({
      session_id: sessionId,
      round_id: roundId,
      entries: four(ids),
    });

    expect(
      tools.get_round_events({ session_id: sessionId, round_id: roundId }).data!
        .events.map((e) => e.kind),
    ).toEqual(["created", "voided", "restored"]);
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(1);
  });
});

describe("sửa rỗng không phải là một bước undo", () => {
  const pair = (ids: string[], d: number) => [
    { playerId: ids[0]!, delta: d },
    { playerId: ids[1]!, delta: -d },
  ];

  it("sau khi lưu y nguyên, Hoàn tác vẫn nhắm vào thao tác THẬT trước đó", () => {
    const { tools, sessionId, ids } = setup();
    tools.record_round({ session_id: sessionId, entries: pair(ids, 1) });
    const rec2 = tools.record_round({ session_id: sessionId, entries: pair(ids, 2) });

    // Mở ván 2 ra, lưu y nguyên.
    tools.update_round({
      session_id: sessionId,
      round_id: rec2.data!.round_id,
      entries: pair(ids, 2),
    });

    // Nhãn vẫn là "thêm ván 2" — chứ không phải "sửa ván 2".
    expect(tools.get_undo_state({ session_id: sessionId }).data!.undo).toBe(
      "Hoàn tác thêm ván 2",
    );

    // Và bấm một lần là ván 2 biến mất luôn, không phải bấm hai lần.
    const undone = tools.undo_last({ session_id: sessionId });
    expect(undone.data!.scoreboard.roundsPlayed).toBe(1);
  });

  it("lưu y nguyên nhiều lần cũng không thêm bước nào", () => {
    const { tools, sessionId, ids } = setup();
    const rec = tools.record_round({ session_id: sessionId, entries: pair(ids, 4) });

    for (let i = 0; i < 5; i += 1) {
      tools.update_round({
        session_id: sessionId,
        round_id: rec.data!.round_id,
        entries: pair(ids, 4),
      });
    }

    // Một lần Hoàn tác là về trắng — không phải sáu lần.
    tools.undo_last({ session_id: sessionId });
    expect(tools.get_scoreboard({ session_id: sessionId }).data!.roundsPlayed).toBe(0);
    expect(tools.get_undo_state({ session_id: sessionId }).data!.undo).toBeNull();
  });
});
