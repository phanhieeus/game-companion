import type { AgentMessage, MemoryFact, MemoryStore } from "./types.ts";

const MAX_FACTS = 20;
/** Giữ đủ ngữ cảnh để hiểu "còn Hùng thì sao", nhưng không đốt token vô hạn. */
const MAX_TURNS = 12;

/**
 * Chỗ cất "nhớ lâu" — tách ra thành cổng vì hai môi trường cất khác nhau.
 *
 * Đọc/ghi hỏng thì NUỐT lỗi và coi như rỗng: quên vài thói quen còn hơn là cả
 * trợ lý không nói được câu nào.
 */
export interface FactStore {
  read(): MemoryFact[];
  write(facts: MemoryFact[]): void;
}

/** Không cất gì cả — dùng cho test và khi chưa cấu hình chỗ lưu. */
export const inMemoryFactStore = (): FactStore => {
  let facts: MemoryFact[] = [];
  return { read: () => facts, write: (next) => void (facts = next) };
};

/**
 * Bộ nhớ hai tầng.
 *
 * - **Nhớ lâu** (`facts`): thói quen và luật nhà học được, sống qua nhiều phiên,
 *   cất qua `FactStore` và được nhét vào system prompt. Ví dụ: "Hùng hay bị
 *   nghe nhầm thành Hùn", "nhà này tính 3 điểm cho ù".
 * - **Nhớ trong lượt** (`turns`): hội thoại của phiên hiện tại, để hiểu câu nói
 *   tham chiếu ngược ("còn Lan thì sao?"). Chỉ nằm trong RAM, mất khi khởi động lại.
 *
 * Tách hai tầng vì chúng có vòng đời khác hẳn nhau: một cái là kiến thức, một
 * cái là ngữ cảnh. Gộp lại thì hoặc quên mất kiến thức, hoặc mang theo cả đống
 * hội thoại cũ không liên quan.
 */
export function createMemory(store: FactStore = inMemoryFactStore()): MemoryStore {
  let turns: AgentMessage[] = [];

  const load = (): MemoryFact[] => {
    try {
      return store.read();
    } catch {
      return [];
    }
  };

  const save = (facts: MemoryFact[]): void => {
    try {
      store.write(facts);
    } catch {
      // Ghi hỏng thì trợ lý vẫn chạy, chỉ là quên sau khi tắt.
    }
  };

  return {
    facts: () => load(),

    remember(text) {
      const trimmed = text.trim();
      const facts = load();
      // Trùng ý thì bỏ qua, đừng để agent nhớ mười lần cùng một điều.
      const existing = facts.find(
        (f) => f.text.toLowerCase() === trimmed.toLowerCase(),
      );
      if (existing) return existing;

      const fact: MemoryFact = {
        id: `fact_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        text: trimmed,
        at: new Date().toISOString(),
      };
      // Quá hạn mức thì bỏ cái cũ nhất — bộ nhớ hữu hạn phải có chính sách.
      save([...facts, fact].slice(-MAX_FACTS));
      return fact;
    },

    forget(id) {
      save(load().filter((f) => f.id !== id));
    },

    turns: () => turns,

    appendTurn(message) {
      turns = [...turns, message].slice(-MAX_TURNS);
    },

    clearTurns() {
      turns = [];
    },
  };
}
