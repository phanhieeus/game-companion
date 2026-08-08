import { beforeEach, describe, expect, it } from "vitest";
import { createMemory, type FactStore } from "./memory.ts";
import type { MemoryFact } from "./types.ts";

/**
 * Chỗ cất giả, dùng chung cho nhiều lần `createMemory` để kiểm phần "sống qua
 * lần khởi động sau". Bản "hỏng" mô phỏng đĩa đầy / không có quyền ghi.
 */
function fakeStore(broken = false): FactStore {
  let facts: MemoryFact[] = [];
  return {
    read() {
      if (broken) throw new Error("đọc hỏng");
      return facts;
    },
    write(next) {
      if (broken) throw new Error("ghi hỏng");
      facts = next;
    },
  };
}

let store: FactStore;
beforeEach(() => {
  store = fakeStore();
});

describe("nhớ lâu — thói quen, luật nhà", () => {
  it("nhớ rồi đọc lại được", () => {
    const memory = createMemory(store);
    memory.remember("Nhà này tính 3 điểm cho ù");

    expect(memory.facts().map((f) => f.text)).toEqual([
      "Nhà này tính 3 điểm cho ù",
    ]);
  });

  it("trùng ý thì chỉ lưu một — đừng nhớ mười lần cùng một điều", () => {
    const memory = createMemory(store);
    const first = memory.remember("Hùng hay bị nghe nhầm thành Hùn");
    const again = memory.remember("hùng HAY bị nghe nhầm thành hùn");

    expect(memory.facts()).toHaveLength(1);
    expect(again.id).toBe(first.id);
  });

  it("quá 20 điều thì bỏ cái cũ nhất — bộ nhớ hữu hạn phải có chính sách", () => {
    const memory = createMemory(store);
    for (let i = 1; i <= 25; i += 1) memory.remember(`điều ${i}`);

    const facts = memory.facts();
    expect(facts).toHaveLength(20);
    expect(facts[0]!.text).toBe("điều 6");
    expect(facts.at(-1)!.text).toBe("điều 25");
  });

  it("quên đúng một điều, giữ nguyên phần còn lại", () => {
    const memory = createMemory(store);
    memory.remember("giữ lại");
    const bin = memory.remember("bỏ đi");

    memory.forget(bin.id);

    expect(memory.facts().map((f) => f.text)).toEqual(["giữ lại"]);
  });

  it("sống qua lần mở app sau — đó là điểm khác biệt với nhớ trong lượt", () => {
    createMemory(store).remember("Lan chỉ chơi tới 10 giờ");

    // Phiên mới, đối tượng memory mới, cùng chỗ cất.
    expect(createMemory(store).facts().map((f) => f.text)).toEqual([
      "Lan chỉ chơi tới 10 giờ",
    ]);
  });
});

describe("nhớ trong lượt — hội thoại phiên hiện tại", () => {
  it("giữ tối đa 12 lượt gần nhất, không đốt token vô hạn", () => {
    const memory = createMemory(store);
    for (let i = 1; i <= 20; i += 1) {
      memory.appendTurn({ role: "user", text: `câu ${i}` });
    }

    const turns = memory.turns();
    expect(turns).toHaveLength(12);
    expect(turns[0]).toMatchObject({ text: "câu 9" });
    expect(turns.at(-1)).toMatchObject({ text: "câu 20" });
  });

  it("clearTurns xoá hội thoại nhưng GIỮ nhớ lâu", () => {
    const memory = createMemory(store);
    memory.remember("luật nhà");
    memory.appendTurn({ role: "user", text: "Nam ăn 3" });

    memory.clearTurns();

    expect(memory.turns()).toEqual([]);
    expect(memory.facts()).toHaveLength(1);
  });

  it("không đụng tới chỗ cất — mất khi khởi động lại là đúng ý đồ", () => {
    const memory = createMemory(store);
    memory.appendTurn({ role: "user", text: "Nam ăn 3" });

    expect(createMemory(store).turns()).toEqual([]);
  });
});

describe("chỗ cất hỏng", () => {
  it("agent vẫn chạy, chỉ là quên sau khi tắt — không sập", () => {
    const memory = createMemory(fakeStore(true));

    expect(() => memory.remember("thử nhớ")).not.toThrow();
    expect(memory.facts()).toEqual([]);

    // Nhớ trong lượt không cần storage nên vẫn phải hoạt động bình thường.
    memory.appendTurn({ role: "user", text: "Nam ăn 3" });
    expect(memory.turns()).toHaveLength(1);
  });
});
