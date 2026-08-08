import { beforeEach, describe, expect, it } from "vitest";
import { MemorySessionRepository } from "../repository/memoryRepository.ts";
import { createTools, __resetIdCounter, type Tools } from "../tools/index.ts";
import { AGENT_TOOLS, toolByName, toolDeclarations } from "./tools.ts";
import type { MemoryFact, MemoryStore, ToolContext } from "./types.ts";

const PLAYERS = [
  { name: "Nam" },
  { name: "Hùng" },
  { name: "Lan" },
  { name: "Tú" },
];

/** Trí nhớ giả — C-010 mới làm bản thật, ở đây chỉ cần đủ để tool chạy. */
function fakeMemory(): MemoryStore {
  let facts: MemoryFact[] = [];
  return {
    facts: () => facts,
    remember(text) {
      const fact = { id: `f${facts.length}`, text, at: "" };
      facts = [...facts, fact];
      return fact;
    },
    forget(id) {
      facts = facts.filter((f) => f.id !== id);
    },
    turns: () => [],
    appendTurn() {},
    clearTurns() {},
  };
}

interface Harness {
  tools: Tools;
  sessionId: string;
  /** Ngữ cảnh MỚI mỗi lần gọi — session là snapshot, sau khi ghi phải đọc lại. */
  ctx(): ToolContext;
  orders: string[];
}

function setup(players = PLAYERS): Harness {
  const repo = new MemorySessionRepository();
  const tools = createTools(repo);
  const created = tools.create_session({ players });
  if (!created.ok) throw new Error("setup failed");
  const sessionId = created.data.session_id;

  const memory = fakeMemory();
  const orders: string[] = [];

  return {
    tools,
    sessionId,
    orders,
    ctx: () => ({
      session: repo.get(sessionId)!,
      tools,
      ui: { setRoundOrder: (o: string) => void orders.push(o) },
      memory,
      // Tool không bao giờ gọi model — có mặt chỉ để thoả kiểu ToolContext.
      model: async () => ({ text: "" }),
    }),
  };
}

/** Chạy một tool như agent sẽ chạy. */
function run(h: Harness, name: string, args: Record<string, unknown> = {}) {
  const tool = toolByName.get(name);
  if (!tool) throw new Error(`không có tool ${name}`);
  return tool.run(args, h.ctx());
}

const entries = (...pairs: [string, number][]) =>
  pairs.map(([player, delta]) => ({ player, delta }));

beforeEach(() => __resetIdCounter());

describe("đi qua đúng tool layer đã có", () => {
  it("chặn ván không cân, cùng lỗi như nhập tay", () => {
    const h = setup();
    const result = run(h, "record_round", {
      entries: entries(["Nam", 3], ["Hùng", -1]),
    });

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      error: expect.stringContaining("bằng 0"),
    });
    // Và không có gì lọt vào sổ.
    expect(h.ctx().session.rounds).toHaveLength(0);
  });

  it("ghi ván cân thì vào bảng, có số thứ tự", () => {
    const h = setup();
    const result = run(h, "record_round", {
      entries: entries(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.data).toMatchObject({ recorded: true, round: 1 });
    expect(h.ctx().session.rounds).toHaveLength(1);
  });

  it("xóa ván qua agent vẫn ghi vào nhật ký — không có lối tắt vòng qua audit", () => {
    const h = setup();
    run(h, "record_round", {
      entries: entries(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
    });
    const roundId = h.ctx().session.rounds[0]!.id;

    run(h, "delete_round", { round: 1 });

    const events = h.tools.get_round_events({
      session_id: h.sessionId,
      round_id: roundId,
    }).data!.events;
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.at(-1)).toMatchObject({ source: "voice" });
  });

  it("sửa ván qua agent đi chung đường update_round", () => {
    const h = setup();
    run(h, "record_round", {
      entries: entries(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
    });

    const result = run(h, "update_round", {
      round: 1,
      entries: entries(["Nam", 6], ["Hùng", -2], ["Lan", -2], ["Tú", -2]),
    });

    expect(result.ok).toBe(true);
    expect(
      h.ctx().session.rounds[0]!.entries.find((e) => e.delta === 6),
    ).toBeTruthy();
  });

  it("không sửa được ván không tồn tại", () => {
    const h = setup();
    const result = run(h, "update_round", {
      round: 9,
      entries: entries(["Nam", 1], ["Hùng", -1]),
    });
    expect(result.data).toMatchObject({ error: expect.stringContaining("9") });
  });
});

describe("khớp tên khi nghe nhầm", () => {
  it("thiếu dấu / thiếu chữ vẫn ra đúng người khi chỉ có một ứng viên", () => {
    const h = setup();
    const result = run(h, "record_round", {
      entries: entries(["Hùn", 3], ["Nam", -1], ["Lan", -1], ["Tú", -1]),
    });

    expect(result.ok).toBe(true);
    const round = h.ctx().session.rounds[0]!;
    const hung = h.ctx().session.players.find((p) => p.name === "Hùng")!;
    expect(round.entries.find((e) => e.playerId === hung.id)?.delta).toBe(3);
  });

  it("KHÔNG đoán bừa khi hai người cùng tiền tố", () => {
    const h = setup([
      { name: "Hùng" },
      { name: "Hùnga" },
      { name: "Lan" },
      { name: "Tú" },
    ]);
    const result = run(h, "record_round", {
      entries: entries(["Hùn", 3], ["Lan", -1], ["Tú", -2]),
    });

    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({
      error: expect.stringContaining("Hùn"),
    });
  });
});

describe("chốt xác nhận khai ở tool, không ở model (ADR 12)", () => {
  const ctxOf = (h: Harness) => h.ctx();

  /**
   * Danh sách này là cái chốt: thêm tool ghi/xóa mới mà quên khai needsConfirm
   * thì test đỏ ngay, chứ không âm thầm ghi điểm không hỏi.
   */
  const MUTATING = [
    "record_round",
    "update_round",
    "delete_round",
    "add_player",
    "remove_player",
    "set_confirm",
    "end_session",
    "forget",
  ];

  it.each(MUTATING)("%s phải hỏi trước khi chạy", (name) => {
    const h = setup();
    const tool = toolByName.get(name)!;
    expect(tool.needsConfirm?.({ enabled: true }, ctxOf(h))).toBe(true);
  });

  it.each(["get_scoreboard", "get_history", "list_memory", "undo", "redo"])(
    "%s không hỏi",
    (name) => {
      const h = setup();
      const tool = toolByName.get(name)!;
      expect(tool.needsConfirm?.({}, ctxOf(h)) ?? false).toBe(false);
    },
  );

  it("record_round theo tuỳ chọn của người dùng", () => {
    const h = setup();
    const tool = toolByName.get("record_round")!;
    expect(tool.needsConfirm!({}, ctxOf(h))).toBe(true);

    h.tools.set_confirm_before_commit({
      session_id: h.sessionId,
      enabled: false,
    });
    expect(tool.needsConfirm!({}, ctxOf(h))).toBe(false);
  });

  it("sửa và xóa hỏi KỂ CẢ khi người dùng đã tắt xác nhận", () => {
    const h = setup();
    h.tools.set_confirm_before_commit({
      session_id: h.sessionId,
      enabled: false,
    });

    // Tắt xác nhận là để ghi ván cho nhanh, không phải để xóa ván không hỏi.
    expect(toolByName.get("update_round")!.needsConfirm!({}, ctxOf(h))).toBe(true);
    expect(toolByName.get("delete_round")!.needsConfirm!({}, ctxOf(h))).toBe(true);
  });
});

describe("thẻ đề xuất — T của T·C·R", () => {
  it("propose trả đúng tên và điểm từng người", () => {
    const h = setup();
    const rows = toolByName.get("record_round")!.propose!(
      { entries: entries(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]) },
      h.ctx(),
    );

    expect(rows).toHaveLength(4);
    expect(rows!.find((r) => r.name === "Nam")?.delta).toBe(3);
    expect(rows!.reduce((s, r) => s + r.delta, 0)).toBe(0);
  });

  it("trả null khi tham số không đọc được — UI lùi về câu chữ", () => {
    const h = setup();
    const tool = toolByName.get("record_round")!;
    expect(tool.propose!({}, h.ctx())).toBeNull();
    expect(
      tool.propose!({ entries: entries(["Ai đó", 3]) }, h.ctx()),
    ).toBeNull();
  });
});

describe("tool đọc", () => {
  it("get_scoreboard trả tên, tổng, hạng", () => {
    const h = setup();
    run(h, "record_round", {
      entries: entries(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
    });

    const rows = run(h, "get_scoreboard").data as {
      name: string;
      total: number;
      rank: number;
    }[];
    expect(rows[0]).toMatchObject({ name: "Nam", total: 3, rank: 1 });
  });

  it("get_history trả ván gần nhất trước, cắt theo limit", () => {
    const h = setup();
    for (const n of [1, 2, 3]) {
      run(h, "record_round", {
        entries: entries(["Nam", n], ["Hùng", -n]),
      });
    }

    const rounds = run(h, "get_history", { limit: 2 }).data as {
      round: number;
    }[];
    expect(rounds.map((r) => r.round)).toEqual([3, 2]);
  });
});

describe("đổi thứ tự bảng — tuỳ chọn hiển thị, không phải dữ liệu ván", () => {
  it("gọi thẳng vào UI chứ không đụng session", () => {
    const h = setup();
    run(h, "set_round_order", { order: "newest-first" });
    expect(h.orders).toEqual(["newest-first"]);
  });

  it("giá trị lạ thì về mặc định, không ném lỗi", () => {
    const h = setup();
    run(h, "set_round_order", { order: "lung tung" });
    expect(h.orders).toEqual(["newest-last"]);
  });
});

describe("khai báo gửi cho Gemini", () => {
  it("mỗi tool có tên, mô tả và schema — không cái nào rỗng", () => {
    for (const declaration of toolDeclarations()) {
      expect(declaration.name).toBeTruthy();
      expect(declaration.description.length).toBeGreaterThan(10);
      expect(declaration.parameters.type).toBe("object");
    }
  });

  it("không lộ hàm chạy ra ngoài — chỉ gửi phần model cần biết", () => {
    for (const declaration of toolDeclarations()) {
      expect(Object.keys(declaration).sort()).toEqual([
        "description",
        "name",
        "parameters",
      ]);
    }
  });

  it("tên tool không trùng nhau", () => {
    expect(toolByName.size).toBe(AGENT_TOOLS.length);
  });
});
