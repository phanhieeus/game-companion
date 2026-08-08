import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { commitRound, resetServer, scriptAgent, recordThenSay, record } from "./fakeAgent";

/** C-001 — bảng điểm nhiều cột theo ván. Verify theo cards/C-001.md. */

// Dữ liệu nằm ở server (ADR 13) — mỗi test phải bắt đầu từ con số không.
test.beforeEach(async ({ page }) => resetServer(page));

async function startSession(page: Page, names: string[]): Promise<void> {
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

/** Ghi một ván qua đúng luồng giọng nói (Gemini giả), rồi xác nhận. */
async function addRound(
  page: Page,
  deltas: Record<string, number>,
): Promise<void> {
  await scriptAgent(page, {
    "ghi ván": recordThenSay(
      record(...(Object.entries(deltas) as [string, number][])),
    ),
  });
  await say(page, "ghi ván");
  await commitRound(page);
}

test("mỗi ván một hàng, số ván ở cột đầu, ván mới nhất ở DƯỚI", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await addRound(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await addRound(page, { Nam: -2, Hùng: 5, Lan: -2, Tú: -1 });
  await addRound(page, { Nam: 1, Hùng: -3, Lan: 1, Tú: 1 });

  const rows = page.locator(".rounds-table tbody tr");
  await expect(rows).toHaveCount(3);

  // Mặc định newest-last: hàng đầu là ván 1, hàng cuối là ván 3.
  await expect(rows.first().locator(".c-seq")).toHaveText("1");
  await expect(rows.last().locator(".c-seq")).toHaveText("3");
});

test("ô hiện delta của đúng người trong đúng ván", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await addRound(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });

  const cells = page.locator(".rounds-table tbody tr").first().locator("td");
  // cột 0..3 = Nam, Hùng, Lan, Tú (cột cuối là nút hủy)
  await expect(cells.nth(0)).toHaveText("+3");
  await expect(cells.nth(1)).toHaveText("-1");
  await expect(cells.nth(3)).toHaveText("-1");
});

test("PRD metric #1: tổng mỗi cột khớp chính xác bảng xếp hạng", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await addRound(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await addRound(page, { Nam: -2, Hùng: 5, Lan: -2, Tú: -1 });
  await addRound(page, { Nam: 1, Hùng: -3, Lan: 1, Tú: 1 });

  // Tổng ở chân bảng, theo thứ tự cột = thứ tự người chơi lúc tạo phiên.
  const footer = page.locator(".rounds-table tfoot td");
  const tableTotals: Record<string, number> = {};
  for (const [i, name] of ["Nam", "Hùng", "Lan", "Tú"].entries()) {
    tableTotals[name] = Number((await footer.nth(i).innerText()).replace("+", ""));
  }

  // C-005 bỏ bảng thứ hai, nên đối chiếu hàng Σ với tổng cộng dồn từ chính
  // các hàng trong bảng — vẫn bắt được lỗi nếu Σ tính sai.
  const summed: Record<string, number> = { Nam: 0, "Hùng": 0, Lan: 0, "Tú": 0 };
  const bodyRows = page.locator(".rounds-table tbody tr");
  for (let r = 0; r < (await bodyRows.count()); r += 1) {
    const cells = bodyRows.nth(r).locator("td");
    for (const [i, name] of ["Nam", "Hùng", "Lan", "Tú"].entries()) {
      const text = (await cells.nth(i).innerText()).trim();
      if (text !== "·") summed[name] = (summed[name] ?? 0) + Number(text.replace("+", ""));
    }
  }

  expect(tableTotals).toEqual(summed);
  // Zero-sum: cả bảng cộng lại phải bằng 0.
  expect(Object.values(tableTotals).reduce((a, b) => a + b, 0)).toBe(0);
});

test("PRD metric #2: 5 người, viewport 360px — KHÔNG cuộn ngang", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú", "Minh"]);
  await addRound(page, { Nam: 4, Hùng: -1, Lan: -1, Tú: -1, Minh: -1 });

  const box = await page.locator(".rounds-table").evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(box.scrollWidth).toBe(box.clientWidth);

  // Cả trang cũng không được tràn ngang.
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);

  await expect(page.locator(".rounds-table thead th")).toHaveCount(7);
});

test("hủy một ván từ bảng thì hàng biến mất và tổng tính lại", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await addRound(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await addRound(page, { Nam: 2, Hùng: -2, Lan: 1, Tú: -1 });
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(2);

  await page.getByRole("button", { name: "Hủy ván 2" }).click();

  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});

/* ---- C-002: nút đổi thứ tự + nút về đầu trang ---- */

test("C-002: đổi thứ tự ván, và lựa chọn sống sót qua reload", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await addRound(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await addRound(page, { Nam: -2, Hùng: 5, Lan: -2, Tú: -1 });
  await addRound(page, { Nam: 1, Hùng: -3, Lan: 1, Tú: 1 });

  const rows = page.locator(".rounds-table tbody tr");
  // Mặc định: mới nhất ở dưới.
  await expect(rows.first().locator(".c-seq")).toHaveText("1");
  await expect(rows.last().locator(".c-seq")).toHaveText("3");

  await page.getByRole("button", { name: "Đổi thứ tự ván" }).click();
  await expect(rows.first().locator(".c-seq")).toHaveText("3");
  await expect(rows.last().locator(".c-seq")).toHaveText("1");

  // Nhớ lựa chọn khi mở lại app.
  await page.reload();
  await expect(page.locator(".rounds-table tbody tr").first().locator(".c-seq"))
    .toHaveText("3");
});

test("C-002: nút về đầu trang ẩn khi ở đầu, hiện sau khi cuộn", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  // C-005 bỏ bảng trên nên trang ngắn hẳn đi — cần nhiều ván hơn mới cuộn được.
  // Chính đó là bằng chứng C-005 có tác dụng.
  for (let i = 0; i < 16; i += 1) {
    await addRound(page, { Nam: 1, Hùng: -1, Lan: 1, Tú: -1 });
  }

  const button = page.getByRole("button", { name: "Về đầu trang" });
  await expect(button).toBeHidden();

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(button).toBeVisible();

  await button.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(50);
});

test("C-003 / PRD metric #3: sau 10 ván 5 người, nút Voice vẫn trong màn hình", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú", "Minh"]);
  for (let i = 0; i < 10; i += 1) {
    await addRound(page, { Nam: 2, Hùng: -1, Lan: -1, Tú: 1, Minh: -1 });
  }
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(10);

  // Không cuộn: nút Voice phải nằm trong viewport ngay khi mở.
  const voice = page.getByRole("button", { name: /Nhấn giữ để nói/ });
  await expect(voice).toBeInViewport();

  // C-005: chỉ còn MỘT bảng — bảng xếp hạng riêng đã bị bỏ.
  await expect(page.locator(".scoreboard")).toHaveCount(0);
  // Không có hàng Hạng (operator không cần).
  await expect(page.locator(".rounds-table .rank-row")).toHaveCount(0);
  // 5 cột người chơi vẫn đủ.
  await expect(page.locator(".rounds-table thead th")).toHaveCount(7);
});
