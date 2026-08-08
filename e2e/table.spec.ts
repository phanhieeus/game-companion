import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";

/** C-001 — bảng điểm nhiều cột theo ván. Verify theo cards/C-001.md. */

async function startSession(page: Page, names: string[]): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");
  for (const [i, name] of names.entries()) {
    if (i >= 4) await page.getByRole("button", { name: "+ Thêm người chơi" }).click();
  }
  for (const [i, name] of names.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

/** Ghi một ván qua đúng luồng giọng nói (mock intent), rồi xác nhận. */
async function record(page: Page, deltas: Record<string, number>): Promise<void> {
  await page.route("**/api/interpret", async (route) => {
    const body = route.request().postDataJSON() as {
      context: { players: { id: string; name: string }[] };
    };
    const id = (n: string) => body.context.players.find((p) => p.name === n)!.id;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: "record_round",
        args: {
          entries: Object.entries(deltas).map(([name, delta]) => ({
            player_id: id(name),
            delta,
          })),
        },
      }),
    });
  });
  await say(page, "ghi ván");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

test("mỗi ván một hàng, số ván ở cột đầu, ván mới nhất ở DƯỚI", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await record(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await record(page, { Nam: -2, Hùng: 5, Lan: -2, Tú: -1 });
  await record(page, { Nam: 1, Hùng: -3, Lan: 1, Tú: 1 });

  const rows = page.locator(".rounds-table tbody tr");
  await expect(rows).toHaveCount(3);

  // Mặc định newest-last: hàng đầu là ván 1, hàng cuối là ván 3.
  await expect(rows.first().locator(".c-seq")).toHaveText("1");
  await expect(rows.last().locator(".c-seq")).toHaveText("3");
});

test("ô hiện delta của đúng người trong đúng ván", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await record(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });

  const cells = page.locator(".rounds-table tbody tr").first().locator("td");
  // cột 0..3 = Nam, Hùng, Lan, Tú (cột cuối là nút hủy)
  await expect(cells.nth(0)).toHaveText("+3");
  await expect(cells.nth(1)).toHaveText("-1");
  await expect(cells.nth(3)).toHaveText("-1");
});

test("PRD metric #1: tổng mỗi cột khớp chính xác bảng xếp hạng", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);
  await record(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await record(page, { Nam: -2, Hùng: 5, Lan: -2, Tú: -1 });
  await record(page, { Nam: 1, Hùng: -3, Lan: 1, Tú: 1 });

  // Tổng ở chân bảng, theo thứ tự cột = thứ tự người chơi lúc tạo phiên.
  const footer = page.locator(".rounds-table tfoot td");
  const tableTotals: Record<string, number> = {};
  for (const [i, name] of ["Nam", "Hùng", "Lan", "Tú"].entries()) {
    tableTotals[name] = Number((await footer.nth(i).innerText()).replace("+", ""));
  }

  // Bảng xếp hạng ở trên.
  const boardTotals: Record<string, number> = {};
  const boardRows = page.locator(".scoreboard .row");
  for (let i = 0; i < (await boardRows.count()); i += 1) {
    const row = boardRows.nth(i);
    const name = (await row.locator(".name").innerText())
      .replace(/·\s*tôi\s*$/u, "")
      .trim();
    boardTotals[name] = Number(
      (await row.locator(".total").innerText()).replace("+", ""),
    );
  }

  expect(tableTotals).toEqual(boardTotals);
  // Zero-sum: cả bảng cộng lại phải bằng 0.
  expect(Object.values(tableTotals).reduce((a, b) => a + b, 0)).toBe(0);
});

test("PRD metric #2: 5 người, viewport 360px — KHÔNG cuộn ngang", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú", "Minh"]);
  await record(page, { Nam: 4, Hùng: -1, Lan: -1, Tú: -1, Minh: -1 });

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
  await record(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  await record(page, { Nam: 2, Hùng: -2, Lan: 1, Tú: -1 });
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(2);

  await page.getByRole("button", { name: "Hủy ván 2" }).click();

  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});
