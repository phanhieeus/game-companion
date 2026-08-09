import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say, spokenLines } from "./fakeSpeech";
import {
  commitRound,
  resetServer,
  scriptAgent,
  recordThenSay,
  record,
  type AgentReply,
} from "./fakeAgent";

/**
 * Luồng end-to-end với model giả lập.
 *
 * Chỉ GEMINI bị giả; server, tool layer và chốt HITL đều là code thật đang chạy
 * (ADR 13). Phần "Gemini có hiểu đúng tiếng Việt không" kiểm ở gemini.spec.ts.
 *
 * Kịch bản là một MẢNG cho mỗi câu: một lượt nói có thể gọi model nhiều lần —
 * bước đầu đề xuất tool, bước sau (đã đọc kết quả tool) mới nói ra câu trả lời.
 */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];

/** Đặt kịch bản ghi ván cho đúng câu sắp nói. */
async function mockRound(
  page: Page,
  text: string,
  round: AgentReply,
  reply = "Xong ván 1.",
): Promise<void> {
  await scriptAgent(page, { [text]: recordThenSay(round, reply) });
}

// Dữ liệu nằm ở server (ADR 13) — mỗi test bắt đầu từ con số không.
test.beforeEach(async ({ page }) => resetServer(page));

async function startSession(page: Page): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");

  for (const [index, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${index + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

/**
 * Đọc điểm tổng từ hàng Σ ở chân bảng.
 *
 * C-005 bỏ bảng xếp hạng riêng ở đầu trang — tổng chỉ còn một chỗ duy nhất.
 */
async function readScoreboard(page: Page): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const headers = page.locator(".rounds-table thead th");
  const footer = page.locator(".rounds-table tfoot td");

  const count = await headers.count();
  if (count === 0) {
    // Chưa ghi ván nào thì chưa có bảng — mọi người đều 0.
    for (const name of ["Nam", "Hùng", "Lan", "Tú"]) result[name] = 0;
    return result;
  }

  // headers: [Ván, ...người chơi, (nút hủy)] → bỏ đầu và cuối.
  for (let i = 1; i < count - 1; i += 1) {
    const name = (await headers.nth(i).innerText()).replace("·", "").trim();
    const total = (await footer.nth(i - 1).innerText()).trim();
    result[name] = Number(total.replace("+", ""));
  }
  return result;
}

test("tạo phiên rồi hiện bảng điểm 4 người, tất cả 0 điểm", async ({ page }) => {
  await startSession(page);
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
  await expect(page.getByText("0 ván")).toBeVisible();
});

test("D1: nói ghi điểm, xác nhận, bảng điểm cập nhật", async ({ page }) => {
  await startSession(page);
  const cau = "Nam ăn 3, ba người kia mỗi người chung 1";
  await mockRound(page, cau, record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]));

  await say(page, cau);

  // Phải hỏi xác nhận TRƯỚC khi ghi, và cho NHÌN THẤY từng con số.
  const card = page.locator(".proposal");
  await expect(card).toContainText("Ghi ván này nhé?");
  await expect(card.locator(".proposal-row")).toHaveCount(4);
  await expect(card.locator(".proposal-row").filter({ hasText: "Nam" })).toContainText("+3");
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });

  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  // Trợ lý trả lời bằng CHỮ trên màn hình, không đọc thành tiếng (ADR 18).
  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toContainText("Xong ván 1");
});

/**
 * Canh chừng chuyện đọc thành tiếng quay lại mà không ai để ý (C-020, ADR 18).
 *
 * Đây là chỗ DUY NHẤT còn dùng `spokenLines`, và nó dùng để chứng minh cái
 * NGƯỢC LẠI với ngày xưa: log giọng đọc phải rỗng. Một lượt nói đủ dài — có
 * hỏi xác nhận, có chốt, có câu trả lời cuối — mà máy vẫn im.
 */
test("trợ lý trả lời bằng chữ, không đọc thành tiếng", async ({ page }) => {
  await startSession(page);
  const cau = "Nam ăn 3, ba người kia mỗi người chung 1";
  await mockRound(page, cau, record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]));

  await say(page, cau);
  await expect(page.locator(".proposal")).toContainText("Ghi ván này nhé?");
  await commitRound(page);
  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toContainText("Xong ván 1");

  expect(await spokenLines(page)).toEqual([]);
});

test("từ chối xác nhận thì không ghi gì", async ({ page }) => {
  await startSession(page);
  await mockRound(page, "Nam ăn 2, Hùng chung 2", record(["Nam", 2], ["Hùng", -2]));

  await say(page, "Nam ăn 2, Hùng chung 2");
  await expect(page.getByText(/Ghi ván này nhé\?/)).toBeVisible();
  await page.getByRole("button", { name: "Bỏ qua" }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

test("nói 'ừ' để xác nhận bằng giọng nói, không cần bấm nút", async ({ page }) => {
  await startSession(page);
  await mockRound(page, "Lan ăn 4, cả làng chung", record(["Lan", 4], ["Tú", -2], ["Nam", -1], ["Hùng", -1]));

  await say(page, "Lan ăn 4, cả làng chung");
  await expect(page.getByText(/Ghi ván này nhé\?/)).toBeVisible();

  await say(page, "ừ");

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toMatchObject({ Lan: 4, Tú: -2 });
});

/**
 * Đổi so với bản NLU cũ: lúc trước tool layer chặn rồi UI hiện thẳng câu lỗi
 * "Tổng phải bằng 0". Với agent, tool chỉ chạy SAU khi người chốt — nên chốt
 * chặn đầu tiên là thẻ đề xuất, nó cộng tổng ngay trước mắt. Bắt sớm hơn một
 * nhịp, và tool layer vẫn là hàng rào cuối nếu người dùng cứ bấm Ghi.
 */
test("tổng khác 0: thẻ đề xuất báo không cân, và ghi vẫn không lọt", async ({
  page,
}) => {
  await startSession(page);
  // Cố tình sai: tổng = +2, giống khi STT nghe nhầm số.
  await mockRound(
    page,
    "Nam ăn 3, Hùng chung 1",
    record(["Nam", 3], ["Hùng", -1]),
    "Chưa ghi được.",
  );

  await say(page, "Nam ăn 3, Hùng chung 1");

  await expect(page.locator(".proposal-sum.bad")).toContainText("không cân");

  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

test("hỏi bảng điểm thì trả lời thẳng, không hỏi xác nhận", async ({ page }) => {
  await startSession(page);

  // Hỏi bảng điểm là vòng ReAct hai bước thật: gọi get_scoreboard, đọc kết quả,
  // rồi mới nói. Ghi ván thì dừng lại chờ người chốt.
  await scriptAgent(page, {
    "Nam ăn 5, cả làng chung": recordThenSay(
      record(["Nam", 5], ["Hùng", -2], ["Lan", -2], ["Tú", -1]),
    ),
    "ai đang dẫn": [
      { call: { name: "get_scoreboard", args: {} } },
      { text: "Nam dẫn với 5 điểm." },
    ],
  });

  await say(page, "Nam ăn 5, cả làng chung");
  await commitRound(page);

  await say(page, "ai đang dẫn");

  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toContainText("Nam dẫn với 5 điểm.");
  await expect(page.getByRole("button", { name: "Ghi", exact: true })).toBeHidden();
});

test("hủy ván thì bảng điểm quay lại như trước", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {
    "Nam ăn 3, ba người kia chung 1": recordThenSay(
      record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
    ),
    "nhầm rồi hủy ván vừa nãy": [
      { call: { name: "delete_round", args: {} } },
      { text: "Hủy rồi." },
    ],
  });

  await say(page, "Nam ăn 3, ba người kia chung 1");
  await commitRound(page);

  await say(page, "nhầm rồi hủy ván vừa nãy");

  // Xóa ván không có con số nào để vẽ, nên thẻ chỉ có câu hỏi + hai nút.
  await expect(page.getByText(/Xóa ván 1 nhé\?/)).toBeVisible();
  await expect(page.locator(".proposal-row")).toHaveCount(0);
  await page.getByRole("button", { name: "Đồng ý" }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

test("câu hỏi lại (clarify) không ghi gì và chờ trả lời", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {
    "Nam thắng 6": [{ text: "6 điểm này ai chung? Chia đều 3 người còn lại nhé?" }],
  });

  await say(page, "Nam thắng 6");

  await expect(page.getByText("6 điểm này ai chung?", { exact: false })).toBeVisible();
  await expect(page.getByText("0 ván")).toBeVisible();
});

test("tắt xác nhận trong cài đặt thì ghi thẳng", async ({ page }) => {
  await startSession(page);
  await mockRound(
    page,
    "Tú ăn 7, cả làng chung",
    record(["Tú", 7], ["Lan", -3], ["Nam", -2], ["Hùng", -2]),
  );

  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByRole("button", { name: "Đang bật" }).click();
  await expect(page.getByRole("button", { name: "Đang tắt" })).toBeVisible();

  await say(page, "Tú ăn 7, cả làng chung");

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toMatchObject({ Tú: 7, Lan: -3 });
});

test("mở lại app vẫn còn phiên đang chơi", async ({ page }) => {
  await startSession(page);
  await mockRound(
    page,
    "Nam ăn 9, cả làng chung",
    record(["Nam", 9], ["Hùng", -3], ["Lan", -3], ["Tú", -3]),
  );

  await say(page, "Nam ăn 9, cả làng chung");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await page.reload();

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toMatchObject({ Nam: 9, Hùng: -3 });
});

/* ══════════ luật nhà (C-030) ══════════ */

/** Đặt bảng hạng ở màn Cài đặt, đúng như người dùng bấm tay. */
async function setRankPoints(page: Page, points: number[]): Promise<void> {
  await page.getByRole("button", { name: "Cài đặt" }).click();
  const labels = ["nhất", "nhì", "ba", "bét"];
  for (const [index, point] of points.entries()) {
    await page.getByLabel(`Điểm hạng ${labels[index]}`).fill(String(point));
  }
  await page.getByRole("button", { name: "Lưu luật nhà" }).click();
  await expect(page.getByText("tổng 0 — cân")).toBeVisible();
  await page.getByRole("button", { name: "Đóng" }).click();
}

test("đặt bảng hạng rồi nói thứ hạng: ra đúng bốn con số, tổng 0", async ({
  page,
}) => {
  await startSession(page);
  await setRankPoints(page, [3, 1, -1, -3]);

  const cau = "Nam nhất, Lan nhì, Hùng ba, Tú bét";
  await scriptAgent(page, {
    [cau]: [
      { call: { name: "record_ranking", args: { ranking: ["Nam", "Lan", "Hùng", "Tú"] } } },
      { text: "Xong ván 1." },
    ],
  });

  await say(page, cau);

  // Con số phải NHÌN THẤY trước khi chốt — người nói chỉ đọc thứ hạng, nên
  // đây là lần đầu họ thấy luật nhà quy ra bao nhiêu điểm.
  const card = page.locator(".proposal");
  await expect(card.locator(".proposal-row")).toHaveCount(4);
  await expect(card.locator(".proposal-row").filter({ hasText: "Nam" })).toContainText("+3");
  await expect(card.locator(".proposal-row").filter({ hasText: "Tú" })).toContainText("-3");

  await commitRound(page);
  expect(await readScoreboard(page)).toEqual({ Nam: 3, Lan: 1, Hùng: -1, Tú: -3 });
});

test("nói thiếu một người thì không ghi, không đoán", async ({ page }) => {
  await startSession(page);
  await setRankPoints(page, [3, 1, -1, -3]);

  // Model quên Tú. Bước sau nó đọc được lời từ chối của tool và hỏi lại.
  const cau = "Nam nhất, Lan nhì, Hùng ba";
  await scriptAgent(page, {
    [cau]: [
      { call: { name: "record_ranking", args: { ranking: ["Nam", "Lan", "Hùng"] } } },
      { text: "Tú xếp thứ mấy?" },
    ],
  });

  await say(page, cau);
  await commitAndExpectRefusal(page);

  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toContainText(
    "Tú xếp thứ mấy?",
  );
  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

/**
 * Chốt một đề xuất mà tool sẽ TỪ CHỐI, rồi đợi thẻ biến mất.
 *
 * Nút chốt ở đây là "Đồng ý" chứ không phải "Ghi": thẻ chỉ mang chữ "Ghi" khi
 * có con số để vẽ, mà ván thiếu người thì không tính ra được con số nào — đó
 * cũng chính là dấu hiệu đầu tiên người dùng thấy là có gì đó chưa đủ.
 */
async function commitAndExpectRefusal(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Ghi|Đồng ý)$/ }).click();
  await expect(page.locator(".proposal")).toBeHidden();
}

test("bonus tứ quý: người ăn +15, ba người kia mỗi người -5", async ({ page }) => {
  await startSession(page);

  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByRole("button", { name: "+ Thêm thưởng" }).click();
  await page.getByLabel("Tên thưởng 1").fill("tứ quý");
  await page.getByLabel("Điểm thưởng 1").fill("5");
  await page.getByRole("button", { name: "Lưu luật nhà" }).click();
  await page.getByRole("button", { name: "Đóng" }).click();

  await scriptAgent(page, {
    "Nam ăn tứ quý": [
      {
        call: {
          name: "record_ranking",
          args: { bonuses: [{ bonus: "tứ quý", player: "Nam" }] },
        },
      },
      { text: "Xong." },
    ],
  });

  await say(page, "Nam ăn tứ quý");
  await commitRound(page);

  expect(await readScoreboard(page)).toEqual({ Nam: 15, Hùng: -5, Lan: -5, Tú: -5 });
});

test("đặt luật bằng LỜI vào đúng chỗ như đặt ở màn Cài đặt", async ({ page }) => {
  await startSession(page);

  await scriptAgent(page, {
    "nhất được 3, nhì 1, ba trừ 1, bét trừ 3": [
      { call: { name: "set_house_rules", args: { rankPoints: [3, 1, -1, -3] } } },
      { text: "Đặt xong luật nhà." },
    ],
  });

  await say(page, "nhất được 3, nhì 1, ba trừ 1, bét trừ 3");
  await expect(page.getByText(/Đặt luật nhà: nhất \+3/)).toBeVisible();
  await page.getByRole("button", { name: "Đồng ý" }).click();

  // Mở màn Cài đặt ra thấy đúng bảng vừa nói — cùng một chỗ, không phải hai.
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByLabel("Điểm hạng nhất")).toHaveValue("3");
  await expect(page.getByLabel("Điểm hạng bét")).toHaveValue("-3");
  await expect(page.getByText("tổng 0 — cân")).toBeVisible();
});

test("bảng hạng lệch số người thì báo rõ, không tính bừa", async ({ page }) => {
  await startSession(page);
  await setRankPoints(page, [3, 1, -1, -3]);

  // Thêm người thứ năm: bảng 4 mức hết dùng được.
  await scriptAgent(page, {
    "thêm Mai vào": [
      { call: { name: "add_player", args: { name: "Mai" } } },
      { text: "Thêm Mai rồi." },
    ],
  });
  await say(page, "thêm Mai vào");
  await page.getByRole("button", { name: "Đồng ý" }).click();
  await expect(page.getByText("Thêm Mai rồi.")).toBeVisible();

  await scriptAgent(page, {
    "Nam nhất, Lan nhì, Hùng ba, Tú tư, Mai bét": [
      {
        call: {
          name: "record_ranking",
          args: { ranking: ["Nam", "Lan", "Hùng", "Tú", "Mai"] },
        },
      },
      { text: "Bảng hạng đang đặt cho 4 người, đặt lại nhé." },
    ],
  });

  await say(page, "Nam nhất, Lan nhì, Hùng ba, Tú tư, Mai bét");
  await commitAndExpectRefusal(page);

  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toContainText(
    "đặt lại",
  );
  await expect(page.getByText("0 ván")).toBeVisible();

  // Và màn Cài đặt đã giãn ra năm ô, chờ đặt lại.
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByLabel("Điểm hạng tư")).toBeVisible();
});

test("bảng hạng không cân thì màn Cài đặt không cho lưu", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: "Cài đặt" }).click();

  for (const [label, point] of [
    ["nhất", 3],
    ["nhì", 1],
    ["ba", -1],
    ["bét", -2],
  ] as const) {
    await page.getByLabel(`Điểm hạng ${label}`).fill(String(point));
  }

  // Thấy ngay trước khi bấm, và bấm rồi thì server vẫn chặn.
  await expect(page.getByText("tổng 1 — không cân")).toBeVisible();
  await page.getByRole("button", { name: "Lưu luật nhà" }).click();
  await expect(page.locator(".rules .warning")).toContainText("bằng 0");
});

test("lỗi từ proxy được báo ra, không ghi gì", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {}, { failures: 1 });

  await say(page, "Nam ăn 3");

  await expect(page.getByText(/Gemini trả lỗi|Không gọi được/)).toBeVisible();
  await expect(page.getByText("0 ván")).toBeVisible();
});
