import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { resetServer, scriptAgent, recordThenSay, record, NAM_AN_3 } from "./fakeAgent";

/** T·C·R — các affordance thêm vào sau khi chạy /tcr-apply. */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];
const CAU = "Nam ăn 3, ba người kia mỗi người chung 1";

/** Kịch bản mặc định cho câu quen thuộc nhất. */
const mockRecord = (page: Page) =>
  scriptAgent(page, { [CAU]: recordThenSay(NAM_AN_3) });

// Dữ liệu nằm ở server (ADR 13) — xoá localStorage không còn tác dụng.
test.beforeEach(async ({ page }) => resetServer(page));

async function startSession(page: Page): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");
  for (const [i, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

test("T: ván đề xuất hiện thành con số, không chỉ đọc lên", async ({ page }) => {
  await startSession(page);
  await mockRecord(page);
  await say(page, CAU);

  const card = page.locator(".proposal");
  await expect(card).toBeVisible();
  await expect(card.locator(".proposal-row")).toHaveCount(4);
  await expect(card.getByText("+3", { exact: true })).toBeVisible();
  // Tổng bằng 0 phải nhìn thấy được để tự kiểm.
  await expect(card.locator(".proposal-sum")).toContainText("0");
  await expect(card.locator(".proposal-sum.ok")).toBeVisible();
});

test("T: ván đã ghi hiện trong lịch sử", async ({ page }) => {
  await startSession(page);
  await mockRecord(page);
  await expect(page.getByText("Chưa ghi ván nào.")).toBeVisible();

  await say(page, CAU);
  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  // C-001 đổi danh sách "Ván gần đây" thành bảng nhiều cột.
  const row = page.locator(".rounds-table tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.first().locator(".c-seq")).toHaveText("1");
  await expect(row.first().locator("td").first()).toHaveText("+3");
});

test("C: hủy ván bằng nút, không cần dùng giọng nói", async ({ page }) => {
  await startSession(page);
  await mockRecord(page);
  await say(page, CAU);
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await page.getByRole("button", { name: "Hủy ván 1" }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  await expect(page.getByText("Chưa ghi ván nào.")).toBeVisible();
});

test("R: lỗi thì thử lại được mà không phải nói lại", async ({ page }) => {
  await startSession(page);

  // Lần gọi model đầu tiên hỏng, lần sau chạy kịch bản — mạng chập chờn.
  await scriptAgent(
    page,
    { "Nam ăn 2 của Hùng": recordThenSay(record(["Nam", 2], ["Hùng", -2])) },
    { failures: 1 },
  );

  await say(page, "Nam ăn 2 của Hùng");
  await expect(page.getByText(/Gemini trả lỗi|Không gọi được/)).toBeVisible();

  // Nút thử lại dùng lại câu cũ — không đụng tới micro.
  await page.getByRole("button", { name: /Thử lại câu vừa nói/ }).click();

  await expect(page.locator(".proposal")).toBeVisible();
});

/**
 * T: ván không cân phải NHÌN THẤY được trước khi bấm Ghi.
 *
 * Bản NLU cũ để tool layer chặn rồi hiện lỗi "Tổng phải bằng 0". Với agent, tool
 * chỉ chạy SAU khi người chốt — nên chốt chặn thật sự là thẻ đề xuất: nó cộng
 * tổng ngay trước mắt và nói thẳng là không cân. Bắt lỗi sớm hơn một nhịp so
 * với trước, và không tốn thêm lượt gọi model nào.
 */
test("T: ván không cân thì thẻ đề xuất nói thẳng, trước khi ghi", async ({
  page,
}) => {
  await startSession(page);
  // Tổng = +2, sai luật zero-sum.
  await scriptAgent(page, {
    "Nam ăn 3, Hùng chung 1": recordThenSay(
      record(["Nam", 3], ["Hùng", -1]),
      "Chưa ghi được.",
    ),
  });

  await say(page, "Nam ăn 3, Hùng chung 1");

  const sum = page.locator(".proposal-sum");
  await expect(sum).toContainText("không cân");
  await expect(page.locator(".proposal-sum.bad")).toBeVisible();

  // Và nếu vẫn bấm Ghi thì tool layer chặn — không ván nào vào bảng.
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("Chưa ghi ván nào.")).toBeVisible();
});

/**
 * Regression: nói một lần rồi thả tay, UI phải về trạng thái dùng được.
 *
 * Lỗi cũ: `busy` tính cả `clarifying` và `confirming` → nút bị khoá đúng lúc
 * agent đang CHỜ người dùng nói. Kẹt cứng, phải reload mới thoát.
 */
test("sau khi agent hỏi lại, nút nói phải dùng được ngay", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {
    "Nam thắng 6": [{ text: "6 điểm này ai chung?" }],
  });

  await say(page, "Nam thắng 6");
  await expect(page.getByText("6 điểm này ai chung?")).toBeVisible();

  // Đây là chỗ hỏng: đang chờ người dùng trả lời mà nút lại khoá.
  const voice = page.getByRole("button", { name: /Nhấn giữ để nói/ });
  await expect(voice).toBeEnabled();
});

test("khi đang chờ xác nhận, nút nói vẫn dùng được", async ({ page }) => {
  await startSession(page);
  await mockRecord(page);

  await say(page, CAU);
  await expect(page.locator(".proposal")).toBeVisible();

  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeEnabled();
});

test("nói xong rồi thả, nút trở lại chữ 'Nhấn giữ để nói'", async ({ page }) => {
  await startSession(page);
  await mockRecord(page);

  await say(page, CAU);
  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  // Về đúng trạng thái ban đầu: chữ nút, và không còn hiệu ứng đang nghe.
  const voice = page.getByRole("button", { name: "Nhấn giữ để nói" });
  await expect(voice).toBeVisible();
  await expect(voice).toBeEnabled();
  await expect(page.locator(".voice-button.active")).toHaveCount(0);
});
