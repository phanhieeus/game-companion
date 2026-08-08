import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech } from "./fakeSpeech";

/**
 * C-004 — nhập điểm bằng tay.
 *
 * Điểm mấu chốt: các test này KHÔNG chạm tới SpeechRecognition giả và KHÔNG mock
 * /api/interpret. Nếu chúng xanh thì đường ghi điểm không-dùng-giọng-nói thật sự
 * chạy độc lập — đúng thứ card này tồn tại để bảo đảm.
 */

async function startSession(page: Page, names: string[]): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");
  for (const [i] of names.entries()) {
    if (i >= 4) await page.getByRole("button", { name: "+ Thêm người chơi" }).click();
  }
  for (const [i, name] of names.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
}

test("ghi một ván hoàn toàn bằng tay, không dùng giọng nói", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);

  await page.getByRole("button", { name: "Nhập tay" }).click();
  await page.getByLabel("Điểm của Nam").fill("3");
  await page.getByLabel("Điểm của Hùng").fill("-1");
  await page.getByLabel("Điểm của Lan").fill("-1");
  await page.getByLabel("Điểm của Tú").fill("-1");

  await expect(page.locator(".manual-sum")).toContainText("Tổng 0");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  // Vào bảng theo ván…
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await expect(
    page.locator(".rounds-table tbody tr").first().locator("td").first(),
  ).toHaveText("+3");
  // …và bảng xếp hạng.
  await expect(page.getByText("1 ván")).toBeVisible();
});

test("tổng khác 0 thì nút Ghi bị khoá và nói rõ lý do", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);

  await page.getByRole("button", { name: "Nhập tay" }).click();
  await page.getByLabel("Điểm của Nam").fill("3");
  await page.getByLabel("Điểm của Hùng").fill("-1");

  await expect(page.locator(".manual-sum")).toContainText(
    "Tổng điểm của ván phải bằng 0",
  );
  await expect(page.getByRole("button", { name: "Ghi", exact: true })).toBeDisabled();

  // Không ghi gì.
  await expect(page.getByText("0 ván")).toBeVisible();
});

test("ván nhập tay hủy được y như ván nói bằng giọng", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);

  await page.getByRole("button", { name: "Nhập tay" }).click();
  await page.getByLabel("Điểm của Nam").fill("2");
  await page.getByLabel("Điểm của Hùng").fill("-2");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);

  await page.getByRole("button", { name: "Hủy ván 1" }).click();
  await expect(page.getByText("0 ván")).toBeVisible();
});

test("PRD metric #4: ≤ 4 thao tác chạm ngoài việc gõ số", async ({ page }) => {
  await startSession(page, ["Nam", "Hùng", "Lan", "Tú"]);

  let taps = 0;
  const tap = async (fn: () => Promise<void>) => {
    taps += 1;
    await fn();
  };

  await tap(async () => page.getByRole("button", { name: "Nhập tay" }).click());
  // Gõ số không tính là thao tác chạm điều hướng.
  await page.getByLabel("Điểm của Nam").fill("1");
  await page.getByLabel("Điểm của Hùng").fill("-1");
  await tap(async () =>
    page.getByRole("button", { name: "Ghi", exact: true }).click(),
  );

  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  expect(taps).toBeLessThanOrEqual(4);
});
