import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSessionRepository } from "./fileRepository.ts";
import { createTools, __resetIdCounter } from "../tools/index.ts";

const PLAYERS = [{ name: "Nam" }, { name: "Hùng" }, { name: "Lan" }, { name: "Tú" }];

let dir: string;
let file: string;

beforeEach(() => {
  __resetIdCounter();
  dir = mkdtempSync(join(tmpdir(), "gc-repo-"));
  file = join(dir, "data/sessions.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Tạo một phiên có 1 ván, trả về id. */
function seed(repo: FileSessionRepository): string {
  const tools = createTools(repo);
  const created = tools.create_session({ players: PLAYERS });
  if (!created.ok) throw new Error("setup failed");
  const id = created.data.session_id;
  const ids = created.data.scoreboard.rows.map((r) => r.playerId);
  tools.record_round({
    session_id: id,
    entries: [
      { playerId: ids[0]!, delta: 3 },
      { playerId: ids[1]!, delta: -1 },
      { playerId: ids[2]!, delta: -1 },
      { playerId: ids[3]!, delta: -1 },
    ],
    source: "manual",
  });
  return id;
}

describe("sống sót qua lần khởi động lại", () => {
  it("đọc lại đúng phiên vừa ghi — thứ localStorage không làm được", () => {
    const id = seed(new FileSessionRepository(file));

    // Tiến trình mới, đối tượng repo mới, cùng file.
    const reopened = new FileSessionRepository(file);
    const session = reopened.get(id);

    expect(session?.players.map((p) => p.name)).toEqual([
      "Nam",
      "Hùng",
      "Lan",
      "Tú",
    ]);
    expect(session?.rounds).toHaveLength(1);
    expect(session?.rounds[0]?.entries.find((e) => e.delta === 3)).toBeTruthy();
  });

  it("activeSession tìm lại được phiên đang chơi sau khi bật lại", () => {
    const id = seed(new FileSessionRepository(file));
    expect(new FileSessionRepository(file).activeSession()?.id).toBe(id);
  });

  it("xoá phiên rồi thì lần bật sau không còn", () => {
    const repo = new FileSessionRepository(file);
    const id = seed(repo);
    repo.delete(id);

    expect(new FileSessionRepository(file).get(id)).toBeUndefined();
  });
});

describe("file hỏng thì khởi động sạch, không sập", () => {
  it("chưa có file — lần chạy đầu tiên", () => {
    expect(() => new FileSessionRepository(file)).not.toThrow();
    expect(new FileSessionRepository(file).list()).toEqual([]);
  });

  it("file rách giữa chừng", () => {
    seed(new FileSessionRepository(file));
    writeFileSync(file, '[{"id":"s1","play', "utf8");

    const repo = new FileSessionRepository(file);
    expect(repo.list()).toEqual([]);
    // Và vẫn ghi tiếp được — không kẹt vĩnh viễn ở trạng thái hỏng.
    expect(() => seed(repo)).not.toThrow();
  });

  it("file đúng JSON nhưng sai kiểu", () => {
    seed(new FileSessionRepository(file));
    writeFileSync(file, '{"không phải": "mảng"}', "utf8");

    expect(new FileSessionRepository(file).list()).toEqual([]);
  });
});

describe("giữ đúng hợp đồng VALUE STORE", () => {
  it("get trả bản sao — sửa nó không đụng dữ liệu đã lưu", () => {
    const repo = new FileSessionRepository(file);
    const id = seed(repo);

    const copy = repo.get(id)!;
    copy.rounds = [];

    expect(repo.get(id)?.rounds).toHaveLength(1);
  });

  it("save lưu bản sao — sửa tham chiếu cũ không lọt vào file", () => {
    const repo = new FileSessionRepository(file);
    const id = seed(repo);

    const mine = repo.get(id)!;
    repo.save(mine);
    mine.status = "ended";

    expect(repo.get(id)?.status).toBe("active");
  });
});

describe("ghi ra đĩa", () => {
  it("file là JSON đọc được bằng mắt, không phải nhị phân", () => {
    const id = seed(new FileSessionRepository(file));
    const raw = readFileSync(file, "utf8");

    expect(raw).toContain("Nam");
    expect(JSON.parse(raw)[0].id).toBe(id);
  });

  it("không để lại file tạm sau khi ghi xong", () => {
    seed(new FileSessionRepository(file));
    expect(() => readFileSync(`${file}.tmp`, "utf8")).toThrow();
  });
});
