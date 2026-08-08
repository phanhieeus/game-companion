import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySessionRepository } from "../repository/memoryRepository.ts";
import { createTools, __resetIdCounter } from "../tools/index.ts";
import { resumeAgent, runAgent } from "./loop.ts";
import type {
  AgentMessage,
  MemoryFact,
  MemoryStore,
  ModelReply,
  ToolContext,
} from "./types.ts";

const PLAYERS = [
  { name: "Nam" },
  { name: "Hùng" },
  { name: "Lan" },
  { name: "Tú" },
];

/** Trí nhớ tối thiểu — bản thật có chỗ cất riêng, xem memory.test.ts. */
function testMemory(): MemoryStore {
  let facts: MemoryFact[] = [];
  let turns: AgentMessage[] = [];
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
    turns: () => turns,
    appendTurn(m) {
      turns = [...turns, m];
    },
    clearTurns() {
      turns = [];
    },
  };
}

interface Harness {
  ctx: ToolContext;
  /** Hội thoại model nhận được ở mỗi lượt — để soi vòng observe có đóng không. */
  sent: AgentMessage[][];
  /** Đặt kịch bản trả lời cho model giả, trả về hàm đã mock để đếm lượt gọi. */
  script(replies: ModelReply[]): ReturnType<typeof vi.fn<() => Promise<ModelReply>>>;
}

function setup(): Harness {
  const repo = new MemorySessionRepository();
  const tools = createTools(repo);
  const created = tools.create_session({ players: PLAYERS });
  if (!created.ok) throw new Error("setup failed");
  const sessionId = created.data.session_id;

  const memory = testMemory();
  const sent: AgentMessage[][] = [];

  // Model giả tiêm thẳng vào ctx — vòng lặp không biết HTTP tồn tại, nên test
  // cũng không phải giả lập tầng mạng.
  let model = vi.fn(async (): Promise<ModelReply> => ({ text: "chưa có kịch bản" }));

  const ctx = {
    tools,
    ui: { setRoundOrder: () => {} },
    memory,
    get session() {
      return repo.get(sessionId)!;
    },
    model: (messages: AgentMessage[]) => {
      sent.push(messages.map((m) => structuredClone(m)));
      return model();
    },
  } as unknown as ToolContext;

  const script = (replies: ModelReply[]) => {
    let turn = 0;
    model = vi.fn(async (): Promise<ModelReply> => {
      const reply = replies[turn];
      turn += 1;
      return reply ?? { text: "Hết kịch bản." };
    });
    return model;
  };

  return { ctx, sent, script };
}

const record = (...pairs: [string, number][]) => ({
  call: {
    name: "record_round",
    args: { entries: pairs.map(([player, delta]) => ({ player, delta })) },
  },
});

beforeEach(() => __resetIdCounter());

describe("vòng ReAct nhiều bước", () => {
  it("gọi tool, đọc kết quả, rồi mới trả lời", async () => {
    const h = setup();
    const model = h.script([
      { call: { name: "get_scoreboard", args: {} } },
      { text: "Cả làng đang hoà 0 hết." },
    ]);

    const result = await runAgent("ai đang dẫn?", h.ctx);

    expect(result.outcome).toEqual({
      type: "final",
      text: "Cả làng đang hoà 0 hết.",
    });
    expect(result.steps).toBe(2);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it("kết quả tool CÓ MẶT trong hội thoại của bước sau — đó mới là observe", async () => {
    const h = setup();
    h.script([
      { call: { name: "get_scoreboard", args: {} } },
      { text: "xong" },
    ]);

    await runAgent("ai đang dẫn?", h.ctx);

    // Lượt 2 phải thấy: câu người nói → model gọi tool → kết quả tool.
    const secondTurn = h.sent[1]!;
    expect(secondTurn.map((m) => m.role)).toEqual(["user", "model", "tool"]);

    const observed = secondTurn.at(-1) as { role: "tool"; result: unknown };
    expect(observed.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Nam", total: 0 }),
      ]),
    );
  });

  it("nhiều bước liên tiếp: đọc bảng rồi ghi ván rồi trả lời", async () => {
    const h = setup();
    h.ctx.tools.set_confirm_before_commit({
      session_id: h.ctx.session.id,
      enabled: false,
    });

    h.script([
      { call: { name: "get_scoreboard", args: {} } },
      record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
      { text: "Ghi rồi nhé." },
    ]);

    const result = await runAgent("Nam ăn 3, ba người kia chung 1", h.ctx);

    expect(result.steps).toBe(3);
    expect(result.changed).toBe(true);
    expect(h.ctx.session.rounds).toHaveLength(1);
  });
});

describe("trần cứng số bước (ADR 11)", () => {
  it("model gọi tool loanh quanh mãi thì dừng ở bước thứ 5", async () => {
    const h = setup();
    // Kịch bản vô tận: lúc nào cũng đòi xem lại bảng.
    const model = h.script(Array.from({ length: 20 }, () => ({
        call: { name: "get_scoreboard", args: {} },
      })),
    );

    const result = await runAgent("làm gì đó đi", h.ctx);

    expect(result.outcome).toMatchObject({
      type: "error",
      retryable: false,
    });
    expect(result.steps).toBe(5);
    // Quan trọng nhất: KHÔNG gọi Gemini lần thứ 6. Đây là chỗ quota bị đốt.
    expect(model).toHaveBeenCalledTimes(5);
  });

  it("chạm trần thì nói thật là chưa xong, không im lặng giả vờ đã làm", async () => {
    const h = setup();
    h.script(Array.from({ length: 20 }, () => ({
        call: { name: "get_scoreboard", args: {} },
      })),
    );

    const result = await runAgent("làm gì đó đi", h.ctx);
    expect(result.outcome).toMatchObject({
      message: expect.stringContaining("chưa làm xong"),
    });
  });
});

describe("chốt HITL cắt ngang vòng lặp", () => {
  it("gặp tool cần chốt thì dừng, và tool CHƯA chạy", async () => {
    const h = setup();
    const model = h.script([
      record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
      { text: "không được gọi tới đây" },
    ]);

    const result = await runAgent("Nam ăn 3", h.ctx);

    expect(result.outcome.type).toBe("confirm");
    expect(h.ctx.session.rounds).toHaveLength(0);
    expect(result.changed).toBe(false);
    // Dừng hẳn: không hỏi model thêm lượt nào trong lúc chờ người.
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("mang theo các dòng số để vẽ thẻ đề xuất", async () => {
    const h = setup();
    h.script([record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1])]);

    const result = await runAgent("Nam ăn 3", h.ctx);

    if (result.outcome.type !== "confirm") throw new Error("phải là confirm");
    expect(result.outcome.rows).toHaveLength(4);
    expect(result.outcome.rows!.find((r) => r.name === "Nam")?.delta).toBe(3);
  });

  it("người đồng ý thì tool chạy và ván vào sổ", async () => {
    const h = setup();
    h.script([record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1])]);

    const first = await runAgent("Nam ăn 3", h.ctx);
    if (first.outcome.type !== "confirm") throw new Error("phải là confirm");

    h.script([{ text: "Ghi rồi." }]);
    const second = await resumeAgent(first.outcome.call, true, h.ctx);

    expect(second.changed).toBe(true);
    expect(h.ctx.session.rounds).toHaveLength(1);
  });

  it("người từ chối thì không chạy tool, và model biết chuyện ở lượt sau", async () => {
    const h = setup();
    h.script([record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1])]);

    const first = await runAgent("Nam ăn 3", h.ctx);
    if (first.outcome.type !== "confirm") throw new Error("phải là confirm");

    const model = h.script([{ text: "không nên gọi" }]);
    const second = await resumeAgent(first.outcome.call, false, h.ctx);

    expect(h.ctx.session.rounds).toHaveLength(0);
    expect(second.changed).toBe(false);
    // Từ chối không tốn thêm lượt gọi model.
    expect(model).not.toHaveBeenCalled();
    // Nhưng hội thoại phải ghi lại, để lượt sau model không đề xuất y hệt.
    const last = h.ctx.memory.turns().at(-1);
    expect(last).toMatchObject({ role: "tool", name: "record_round" });
  });
});

describe("lỗi", () => {
  it("hàm model ném exception thì thành lỗi đọc được, không sập vòng lặp", async () => {
    const h = setup();
    h.script([]);
    // Kịch bản rỗng nhưng model tự nổ — mô phỏng hỏng ngoài dự tính.
    h.ctx.model = async () => {
      throw new Error("boom");
    };

    const result = await runAgent("Nam ăn 3", h.ctx);

    expect(result.outcome).toMatchObject({
      type: "error",
      retryable: true,
      message: expect.stringContaining("trục trặc"),
    });
  });

  it("model trả lỗi thì giữ nguyên cờ retryable của nó", async () => {
    const h = setup();
    h.script([
      { error: "Hết quota Gemini hôm nay.", retryable: false },
    ]);

    const result = await runAgent("Nam ăn 3", h.ctx);

    expect(result.outcome).toMatchObject({
      type: "error",
      retryable: false,
      message: "Hết quota Gemini hôm nay.",
    });
  });

  it("model gọi tool không tồn tại thì báo lại cho model, không sập", async () => {
    const h = setup();
    h.script([
      { call: { name: "bay_len_troi", args: {} } },
      { text: "Xin lỗi, mình không làm được việc đó." },
    ]);

    const result = await runAgent("bay lên trời đi", h.ctx);

    expect(result.outcome.type).toBe("final");
    const observed = h.sent[1]!.at(-1) as { result: { error?: string } };
    expect(observed.result).toMatchObject({
      error: expect.stringContaining("bay_len_troi"),
    });
  });

  it("model không nói gì thì hỏi lại chứ không đoán", async () => {
    const h = setup();
    h.script([{ text: "   " }]);

    const result = await runAgent("ừm", h.ctx);
    expect(result.outcome.type).toBe("clarify");
  });
});

describe("tool tự nói được thì khỏi tốn thêm một lượt model", () => {
  it("undo trả câu nói luôn, dừng ngay", async () => {
    const h = setup();
    h.ctx.tools.record_round({
      session_id: h.ctx.session.id,
      entries: h.ctx.session.players.map((p, i) => ({
        playerId: p.id,
        delta: i === 0 ? 3 : -1,
      })),
      source: "manual",
    });

    const model = h.script([
      { call: { name: "undo", args: {} } },
      { text: "không nên gọi tới đây" },
    ]);

    const result = await runAgent("hoàn tác đi", h.ctx);

    expect(result.outcome.type).toBe("final");
    expect(model).toHaveBeenCalledTimes(1);
    expect(h.ctx.session.rounds.filter((r) => r.status === "recorded")).toHaveLength(0);
  });
});
