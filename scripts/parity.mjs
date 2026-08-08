/**
 * Đối chiếu bản TypeScript và bản Python trên CÙNG một kịch bản.
 *
 * "Test tôi tự viết xanh" không chứng minh dịch đúng — tôi viết cả test lẫn code
 * nên hiểu sai chỗ nào thì sai đều cả hai. Chạy cùng một chuỗi thao tác qua hai
 * bản rồi so kết quả thì mới bắt được lệch.
 *
 * Chạy: node scripts/parity.mjs
 */

import { execFileSync } from "node:child_process";
import { createTools, __resetIdCounter } from "../server/tools/index.ts";
import { MemorySessionRepository } from "../server/repository/memoryRepository.ts";

/** Kịch bản dùng chung — mô tả bằng dữ liệu để hai bên chạy y hệt. */
const SCRIPT = [
  { op: "record", deltas: [3, -1, -1, -1] },
  { op: "record", deltas: [-2, 5, -2, -1] },
  { op: "record", deltas: [0, -4, 4, 0] },
  { op: "update", round: 2, deltas: [-3, 6, -2, -1] },
  { op: "undo_round", round: 3 },
  { op: "record", deltas: [1, 1, -1, -1] },
  { op: "undo_last" },
  { op: "undo_last" },
  { op: "redo_last" },
];

function runTypeScript() {
  __resetIdCounter();
  const repo = new MemorySessionRepository();
  const tools = createTools(repo);

  const created = tools.create_session({
    players: [{ name: "Nam" }, { name: "Hùng" }, { name: "Lan" }, { name: "Tú" }],
  });
  const sessionId = created.data.session_id;
  const ids = created.data.scoreboard.rows.map((r) => r.playerId);
  const roundIds = [];

  const entries = (deltas) =>
    deltas.map((delta, i) => ({ playerId: ids[i], delta }));

  for (const step of SCRIPT) {
    if (step.op === "record") {
      const r = tools.record_round({
        session_id: sessionId,
        entries: entries(step.deltas),
        source: "manual",
      });
      roundIds.push(r.ok ? r.data.round_id : null);
    } else if (step.op === "update") {
      tools.update_round({
        session_id: sessionId,
        round_id: roundIds[step.round - 1],
        entries: entries(step.deltas),
        source: "manual",
      });
    } else if (step.op === "undo_round") {
      tools.undo_round({
        session_id: sessionId,
        round_id: roundIds[step.round - 1],
        source: "manual",
      });
    } else if (step.op === "undo_last") {
      tools.undo_last({ session_id: sessionId });
    } else if (step.op === "redo_last") {
      tools.redo_last({ session_id: sessionId });
    }
  }

  const board = tools.get_scoreboard({ session_id: sessionId }).data;
  const undo = tools.get_undo_state({ session_id: sessionId }).data;
  const session = repo.get(sessionId);

  return {
    scoreboard: board.rows.map((r) => [r.name, r.total, r.rank]),
    roundsPlayed: board.roundsPlayed,
    undo,
    // Nhật ký: chỉ lấy phần có ý nghĩa nghiệp vụ (id và mốc thời gian khác nhau
    // giữa hai lần chạy là đương nhiên, không phải lệch).
    events: session.rounds.map((r) => ({
      seq: r.sequenceNo,
      status: r.status,
      kinds: (r.events ?? []).map((e) => e.kind),
      flags: (r.events ?? []).map((e) => `${e.isUndo ? "U" : ""}${e.isRedo ? "R" : ""}`),
    })),
  };
}

function runPython() {
  const out = execFileSync(
    ".venv/bin/python",
    ["scripts/parity.py", JSON.stringify(SCRIPT)],
    { encoding: "utf8" },
  );
  return JSON.parse(out);
}

const ts = runTypeScript();
const py = runPython();

const same = JSON.stringify(ts) === JSON.stringify(py);

console.log("── TypeScript ─────────────────────────────");
console.log("bảng   :", JSON.stringify(ts.scoreboard));
console.log("số ván :", ts.roundsPlayed);
console.log("undo   :", JSON.stringify(ts.undo));
console.log("nhật ký:", JSON.stringify(ts.events));
console.log("── Python ─────────────────────────────────");
console.log("bảng   :", JSON.stringify(py.scoreboard));
console.log("số ván :", py.roundsPlayed);
console.log("undo   :", JSON.stringify(py.undo));
console.log("nhật ký:", JSON.stringify(py.events));
console.log("───────────────────────────────────────────");
console.log(same ? "KHỚP HOÀN TOÀN ✓" : "LỆCH ✗");

if (!same) process.exit(1);
