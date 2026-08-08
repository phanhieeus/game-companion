/**
 * Kiểm tra Gemini có hiểu đúng câu tiếng Việt không — không cần micro.
 *
 * Đây là thứ duy nhất micro mới đo được: STT ra chữ gì thì mình chịu, nhưng
 * TỪ CHỮ TRỞ ĐI thì kiểm được hết. Script gửi thẳng các câu mẫu vào proxy và
 * so intent + tham số với kỳ vọng.
 *
 *   node server/index.js &      (hoặc npm run dev:api)
 *   npm run check:nlu
 *
 * Mỗi câu tốn 1 lượt trong quota 1000/ngày.
 */

const BASE = process.env.API_BASE || "http://localhost:8787";

const PLAYERS = [
  { id: "p_nam", name: "Nam" },
  { id: "p_hung", name: "Hùng" },
  { id: "p_lan", name: "Lan" },
  { id: "p_tu", name: "Tú" },
];

const CONTEXT = {
  players: PLAYERS,
  scoreboard: PLAYERS.map((p) => ({ playerId: p.id, total: 0 })),
  mePlayerId: "p_tu",
  zeroSum: true,
  roundsPlayed: 4,
};

const id = (name) => PLAYERS.find((p) => p.name === name).id;

/** entries khớp không kể thứ tự. */
function entriesMatch(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  const norm = (list) =>
    [...list]
      .map((e) => `${e.player_id}:${e.delta}`)
      .sort()
      .join("|");
  return norm(actual) === norm(expected);
}

const CASES = [
  {
    say: "Ván này Nam ăn 3, ba người kia mỗi người chung 1",
    intent: "record_round",
    check: (a) =>
      entriesMatch(a.entries, [
        { player_id: id("Nam"), delta: 3 },
        { player_id: id("Hùng"), delta: -1 },
        { player_id: id("Lan"), delta: -1 },
        { player_id: id("Tú"), delta: -1 },
      ]),
    why: "cụm gộp 'ba người kia' + tổng phải bằng 0",
  },
  {
    say: "Nam thắng 6",
    intent: "clarify",
    why: "thiếu thông tin ai chung — KHÔNG được tự bịa cách chia",
  },
  {
    say: "Ai đang dẫn?",
    intent: "query_scoreboard",
    why: "tra cứu, trả lời thẳng",
  },
  {
    say: "Tôi được bao nhiêu rồi?",
    intent: "query_player",
    check: (a) => a.player_id === "p_tu",
    why: "'tôi' phải map về người cầm máy (Tú)",
  },
  {
    say: "Hùng mấy điểm?",
    intent: "query_player",
    check: (a) => a.player_id === id("Hùng"),
    why: "hỏi điểm một người cụ thể",
  },
  {
    say: "Nhầm rồi, hủy ván vừa nãy",
    intent: "undo_round",
    why: "hủy ván gần nhất",
  },
  {
    say: "Minh thắng 3",
    intent: "clarify",
    why: "tên lạ không có trong phiên — phải hỏi lại, không được đoán bừa",
  },
  {
    say: "Lan ăn 4 của Hùng",
    intent: "record_round",
    check: (a) =>
      entriesMatch(a.entries, [
        { player_id: id("Lan"), delta: 4 },
        { player_id: id("Hùng"), delta: -4 },
      ]),
    why: "chuyển điểm giữa hai người",
  },
  {
    say: "Kết thúc, tính tổng đi",
    intent: "end_session",
    why: "kết thúc phiên",
  },
  {
    say: "Hôm nay thời tiết thế nào",
    intent: "unsupported",
    why: "ngoài phạm vi app",
  },
];

async function main() {
  const health = await fetch(`${BASE}/api/health`)
    .then((r) => r.json())
    .catch(() => null);

  if (!health) {
    console.error(`Không gọi được ${BASE}. Chạy 'npm run dev:api' trước.`);
    process.exit(1);
  }
  if (!health.hasKey) {
    console.error("Server chưa có GEMINI_API_KEY. Điền vào .env rồi chạy lại.");
    process.exit(1);
  }
  console.log(`Model: ${health.model}\n`);

  let passed = 0;
  const failures = [];
  let first = true;

  for (const test of CASES) {
    // Free tier chỉ cho 15 lượt/phút. Bắn liên tục là dính 429 và cả loạt
    // test đỏ oan, tưởng prompt sai trong khi chỉ là quá nhanh.
    if (!first) await new Promise((r) => setTimeout(r, 4500));
    first = false;

    const response = await fetch(`${BASE}/api/interpret`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transcript: test.say, context: CONTEXT }),
    });
    const result = await response.json();

    if (result.error) {
      console.log(`✗ "${test.say}"\n   lỗi: ${result.error}\n`);
      failures.push({ ...test, got: result.error });
      continue;
    }

    const intentOk = result.intent === test.intent;
    const argsOk = intentOk && (!test.check || test.check(result.args ?? {}));

    if (intentOk && argsOk) {
      passed += 1;
      console.log(`✓ "${test.say}" → ${result.intent}`);
    } else {
      console.log(
        `✗ "${test.say}"\n   mong đợi ${test.intent} (${test.why})\n   nhận được ${result.intent} ${JSON.stringify(result.args)}\n`,
      );
      failures.push({ ...test, got: result });
    }
  }

  console.log(`\n${passed}/${CASES.length} đúng.`);

  if (failures.length > 0) {
    console.log(
      "\nCác câu sai ở trên cho biết cần sửa system prompt trong server/index.js.",
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
