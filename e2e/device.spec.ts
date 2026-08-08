import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { resetServer, scriptAgent, recordThenSay, record, commitRound } from "./fakeAgent";

/**
 * C-019 — phiên thuộc về THIẾT BỊ, và chỉ người dùng mới kết thúc được nó.
 *
 * Hai context Playwright = hai localStorage = hai `deviceId`, đúng như hai cái
 * điện thoại. Đây là chỗ duy nhất kiểm được điều đó: test Python gọi thẳng repo
 * và HTTP, còn cái header kia do trình duyệt tự sinh và tự nhớ — chỉ chạy thật
 * mới biết nó có sống qua một lần tải lại trang hay không.
 */

const LANG_A = ["Nam", "Hùng", "Lan", "Tú"];
const LANG_B = ["An", "Bình", "Cường", "Dũng"];

async function taoPhien(page: Page, ten: string[]): Promise<void> {
  await page.goto("/");
  for (const [i, n] of ten.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(n);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

test("hai thiết bị khác nhau chơi hai ván bài khác nhau", async ({ browser }) => {
  const may1 = await browser.newContext();
  const may2 = await browser.newContext();
  const a = await may1.newPage();
  const b = await may2.newPage();

  await resetServer(a);
  await installFakeSpeech(a);
  await installFakeSpeech(b);

  const cauA = "Nam ăn 3, ba người kia mỗi người chung 1";
  const cauB = "An ăn 6, ba người kia mỗi người chung 2";
  await scriptAgent(a, {
    [cauA]: recordThenSay(record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1])),
    [cauB]: recordThenSay(record(["An", 6], ["Bình", -2], ["Cường", -2], ["Dũng", -2])),
  });

  await taoPhien(a, LANG_A);
  await say(a, cauA);
  await commitRound(a);
  await expect(a.getByText("1 ván")).toBeVisible();

  // Máy 2 mở app lần đầu: KHÔNG được rơi vào ván bài của máy 1.
  await b.goto("/");
  await expect(b.getByRole("button", { name: "Bắt đầu chơi" })).toBeVisible();

  await taoPhien(b, LANG_B);
  await expect(b.getByText("0 ván")).toBeVisible();
  await say(b, cauB);
  await commitRound(b);
  await expect(b.locator(".rounds-table thead")).toContainText("An");
  await expect(b.locator(".rounds-table thead")).not.toContainText("Nam");
  await expect(b.locator(".rounds-table tfoot td").first()).toHaveText("+6");

  // Máy 1 không hề bị máy 2 làm sao.
  await a.reload();
  await expect(a.getByText("1 ván")).toBeVisible();
  await expect(a.locator(".rounds-table tfoot td").first()).toHaveText("+3");

  await may1.close();
  await may2.close();
});

test("thoát giữa chừng rồi mở lại là về đúng phiên cũ", async ({ page }) => {
  await resetServer(page);
  await installFakeSpeech(page);

  const cau = "Nam ăn 3, ba người kia mỗi người chung 1";
  await scriptAgent(page, {
    [cau]: recordThenSay(record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1])),
  });

  await taoPhien(page, LANG_A);
  await say(page, cau);
  await commitRound(page);

  // Đóng tab giữa ván bài rồi mở lại — không bấm kết thúc gì cả.
  await page.goto("about:blank");
  await page.goto("/");

  await expect(page.getByText("1 ván")).toBeVisible();
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});

test("bấm Kết thúc phiên rồi mới ra màn hình tạo phiên mới", async ({ page }) => {
  await resetServer(page);
  await installFakeSpeech(page);
  await taoPhien(page, LANG_A);

  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByRole("button", { name: "Kết thúc phiên" }).click();

  await expect(page.getByRole("button", { name: "Bắt đầu chơi" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Bắt đầu chơi" })).toBeVisible();
});
