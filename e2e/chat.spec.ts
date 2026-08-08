import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { resetServer, scriptAgent, recordThenSay, record } from "./fakeAgent";

/**
 * C-024 — khu tương tác là một mạch hội thoại, nhập bằng chữ hoặc giọng nói.
 *
 * Điều đáng kiểm nhất ở đây không phải bong bóng vẽ đẹp hay không, mà là hai
 * đường vào (chữ và giọng) đi CÙNG một lối phía sau: cùng chốt xác nhận, cùng
 * ghi vào bảng. Nếu gõ chữ mà lọt qua được chốt HITL thì bất biến của cả app
 * hỏng, và đó chính là thứ các test dưới đây canh.
 */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];
const CAU = "Nam ăn 3, ba người kia mỗi người chung 1";

test.beforeEach(async ({ page }) => resetServer(page));

async function startSession(page: Page, names = PLAYERS): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");
  for (let i = 4; i < names.length; i += 1) {
    await page.getByRole("button", { name: "+ Thêm người chơi" }).click();
  }
  for (const [i, name] of names.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

/** Gõ một câu rồi bấm gửi — thao tác thật của người ngồi quán ồn. */
async function typeSend(page: Page, text: string): Promise<void> {
  await page.getByLabel("Nhập câu cho trợ lý").fill(text);
  await page.getByRole("button", { name: "Gửi" }).click();
}

test("gõ chữ rồi bấm gửi thì ván vào bảng y như khi nói", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {
    [CAU]: recordThenSay(
      record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
      "Xong ván 1.",
    ),
  });

  await typeSend(page, CAU);

  // Gõ chữ KHÔNG được đi tắt qua chốt xác nhận — vẫn phải hỏi trước khi ghi.
  await expect(page.locator(".proposal")).toContainText("Ghi ván này nhé?");
  await expect(page.locator(".proposal-row")).toHaveCount(4);

  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await expect(page.getByText("1 ván")).toBeVisible();
  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toContainText(
    "Xong ván 1",
  );
  // Câu gõ vào phải nằm trong mạch, không biến mất sau khi gửi.
  await expect(page.locator(".bubble.you")).toContainText(CAU);
});

test("gửi xong thì ô nhập trống lại, không phải tự xoá tay", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, { "Ai đang dẫn": [{ text: "Chưa ai ghi ván nào." }] });

  await typeSend(page, "Ai đang dẫn");

  await expect(page.getByLabel("Nhập câu cho trợ lý")).toHaveValue("");
});

test("ô nhập trống thì nút gửi khoá — không gửi câu rỗng lên model", async ({
  page,
}) => {
  await startSession(page);
  await expect(page.getByRole("button", { name: "Gửi" })).toBeDisabled();

  await page.getByLabel("Nhập câu cho trợ lý").fill("Nam ăn 3");
  await expect(page.getByRole("button", { name: "Gửi" })).toBeEnabled();
});

test("hội thoại giữ lại lượt trước, không chỉ hiện câu cuối", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {
    "Ai đang dẫn": [{ text: "Chưa ai ghi ván nào." }],
    "Còn mấy ván nữa": [{ text: "Chưa có ván nào cả." }],
  });

  await typeSend(page, "Ai đang dẫn");
  await expect(page.locator(".bubble.agent")).toContainText("Chưa ai ghi ván nào.");

  await say(page, "Còn mấy ván nữa");
  await expect(
    page.locator(".bubble.agent:not(.thinking)").last(),
  ).toContainText("Chưa có ván nào cả.");

  // Lượt CŨ vẫn còn — đây là toàn bộ lý do card này tồn tại.
  await expect(page.locator(".bubble.you")).toHaveCount(2);
  await expect(page.locator(".bubble.you").first()).toContainText("Ai đang dẫn");
  await expect(page.locator(".bubble.agent:not(.thinking)")).toHaveCount(2);
  await expect(
    page.locator(".bubble.agent:not(.thinking)").first(),
  ).toContainText("Chưa ai ghi ván nào.");
});

test("một lượt gõ chữ và một lượt nói nằm chung một mạch", async ({ page }) => {
  await startSession(page);
  await scriptAgent(page, {
    "Ai đang dẫn": [{ text: "Chưa ai ghi ván nào." }],
    [CAU]: recordThenSay(
      record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
      "Xong ván 1.",
    ),
  });

  await typeSend(page, "Ai đang dẫn");
  await expect(page.locator(".bubble.agent")).toContainText("Chưa ai ghi ván nào.");

  await say(page, CAU);
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await expect(page.locator(".bubble.you")).toHaveCount(2);
});

test("thẻ đề xuất đọc được TỪ DÒNG ĐẦU, không bị cắt mất người ăn", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  // 5 người: thẻ đề xuất cao nhất có thể — đúng chỗ dễ bị cắt nhất.
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú", "Mai"]);
  // Nói vài lượt trước để mạch dài hơn khung — đúng tình huống làm lộ lỗi.
  const CAU5 = "Nam ăn bốn, bốn người kia mỗi người chung một";
  await scriptAgent(page, {
    "Ai đang dẫn": [{ text: "Chưa ai ghi ván nào." }],
    "Còn mấy ván": [{ text: "Chưa có ván nào." }],
    "Luật nhà thế nào": [{ text: "Chưa đặt luật riêng nào cả." }],
    [CAU5]: recordThenSay(
      record(["Nam", 4], ["Hùng", -1], ["Lan", -1], ["Tú", -1], ["Mai", -1]),
      "Xong ván 1.",
    ),
  });
  for (const q of ["Ai đang dẫn", "Còn mấy ván", "Luật nhà thế nào"]) {
    await typeSend(page, q);
    await expect(page.locator(".bubble.you").last()).toContainText(q);
    await expect(page.locator(".bubble.agent:not(.thinking)").last()).toBeVisible();
  }

  await say(page, CAU5);
  await expect(page.locator(".proposal-row")).toHaveCount(5);

  // Trên production đã thấy tận mắt: khung cuộn xuống đáy thì mép trên thẻ bị
  // cắt, và dòng người ĂN — con số lớn nhất — nằm ngoài màn hình. Người dùng
  // bấm Ghi mà chưa từng nhìn thấy nó. MỌI dòng phải đọc được, không chỉ dòng
  // cuối và nút bấm.
  await expect(page.locator(".proposal-head")).toBeInViewport({ ratio: 1 });
  const rows = page.locator(".proposal-row");
  for (let i = 0; i < 5; i += 1) await expect(rows.nth(i)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Ghi", exact: true })).toBeInViewport({ ratio: 1 });
});

test("màn ngắn (bàn phím ảo mở): thẻ cắt thì cắt từ DƯỚI, số vẫn đọc được", async ({
  page,
}) => {
  // 360×480 ≈ điện thoại nhỏ đang mở bàn phím ảo. Ở đây thẻ 5 người CAO HƠN cả
  // khung, nên có cắt cũng phải cắt đằng nào: cắt từ dưới thì người dùng cuộn
  // một cái là tới nút Ghi; cắt từ trên thì con số biến mất mà chẳng báo gì.
  await page.setViewportSize({ width: 360, height: 480 });
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú", "Mai"]);
  const CAU5 = "Nam ăn bốn, bốn người kia mỗi người chung một";
  await scriptAgent(page, {
    [CAU5]: recordThenSay(
      record(["Nam", 4], ["Hùng", -1], ["Lan", -1], ["Tú", -1], ["Mai", -1]),
      "Xong ván 1.",
    ),
  });

  await say(page, CAU5);
  await expect(page.locator(".proposal-row")).toHaveCount(5);

  await expect(page.locator(".proposal-head")).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".proposal-row").first()).toBeInViewport({ ratio: 1 });
  await expect(page.locator(".proposal-row").first()).toContainText("+4");
});

test("@360px: composer không đẩy trang cuộn ngang", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startSession(page);

  await page.getByLabel("Nhập câu cho trợ lý").fill(
    "Nam ăn ba, Hùng chung một, Lan chung một, Tú chung một, ghi giúp tôi nhé",
  );

  // Metric PRD #2: màn 360px không được cuộn ngang.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("khung chat cuộn trong chính nó, không đẩy bảng điểm đi mất", async ({
  page,
}) => {
  await startSession(page);
  const script: Record<string, { text: string }[]> = {};
  for (let i = 1; i <= 6; i += 1) script[`Câu ${i}`] = [{ text: `Trả lời ${i}.` }];
  await scriptAgent(page, script);

  for (let i = 1; i <= 6; i += 1) {
    await typeSend(page, `Câu ${i}`);
    await expect(
      page.locator(".bubble.agent:not(.thinking)").last(),
    ).toContainText(`Trả lời ${i}.`);
  }

  // Khung có trần chiều cao và tự cuộn — nếu không, sáu lượt đủ đẩy bảng điểm
  // ra khỏi màn hình và người dùng mất chỗ liếc số.
  const scrolls = await page.evaluate(() => {
    const box = document.querySelector(".chat") as HTMLElement | null;
    if (!box) return null;
    return { over: box.scrollHeight > box.clientHeight, top: box.scrollTop };
  });
  expect(scrolls?.over).toBe(true);
  // Lượt mới nhất phải nằm trong tầm mắt, không rơi xuống dưới mép.
  await expect(page.locator(".bubble.agent:not(.thinking)").last()).toBeInViewport({ ratio: 1 });
});
