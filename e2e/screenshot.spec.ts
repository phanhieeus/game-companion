import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { resetServer, scriptAgent, recordThenSay, record } from "./fakeAgent";

/** Chụp màn hình để xem UI thật, không đoán. Chạy: npx playwright test screenshot */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];

/** Đặt kịch bản cho câu sắp nói. Mọi ảnh đều chụp app chạy trên backend thật. */
async function mock(page: Page, text: string, deltas: [string, number][]) {
  await scriptAgent(page, { [text]: recordThenSay(record(...deltas)) });
}

test.beforeEach(async ({ page }) => resetServer(page));

test("chụp các màn hình chính", async ({ page }) => {
  await installFakeSpeech(page);
  await page.goto("/");
  await page.screenshot({ path: "screenshots/1-setup.png", fullPage: true });

  for (const [i, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await page.screenshot({ path: "screenshots/2-empty.png", fullPage: true });

  // Ghi 2 ván để có lịch sử.
  const cau = "Nam ăn 3, ba người kia mỗi người chung 1";
  await mock(page, cau, [["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]]);
  await say(page, cau);
  await page.screenshot({ path: "screenshots/3-confirm.png", fullPage: true });
  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await mock(page, "Tú ăn 5", [["Tú", 5], ["Nam", -2], ["Hùng", -2], ["Lan", -1]]);
  await say(page, "Tú ăn 5");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/4-played.png", fullPage: true });
});

/**
 * Done-evidence cho C-010: nói một câu → thẻ đề xuất hiện con số, ván cũ đã
 * nằm trong bảng phía trên. Chụp ở 360px vì đó là màn hình thật người ta cầm.
 */
test("C-010 done-evidence: agent đề xuất ván bằng giọng nói @360px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await installFakeSpeech(page);
  await page.goto("/");

  for (const [i, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();

  // Ván 1 ghi xong, để bảng có dữ liệu thật phía sau thẻ đề xuất.
  const cau = "Nam ăn 3, ba người kia mỗi người chung 1";
  await mock(page, cau, [["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]]);
  await say(page, cau);
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  // Ván 2 đang chờ chốt — đây là lúc chụp.
  const cau2 = "Lan ăn 4, Nam chung 2, Hùng với Tú mỗi người 1";
  await mock(page, cau2, [["Lan", 4], ["Nam", -2], ["Hùng", -1], ["Tú", -1]]);
  await say(page, cau2);
  await expect(page.locator(".proposal-row")).toHaveCount(4);

  await page.screenshot({ path: "screenshots/13-agent.png", fullPage: true });
});

/** Done-evidence cho C-001: 5 người, 3 ván, viewport 360px, không cuộn ngang. */
test("C-001 done-evidence: bảng 5 người 3 ván @360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await installFakeSpeech(page);
  await page.goto("/");
  await page.getByRole("button", { name: "+ Thêm người chơi" }).click();
  for (const [i, name] of ["Nam", "Hùng", "Lan", "Tú", "Minh"].entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();

  const rounds: [string, number][][] = [
    [["Nam", 4], ["Hùng", -1], ["Lan", -1], ["Tú", -1], ["Minh", -1]],
    [["Minh", 6], ["Nam", -2], ["Hùng", -2], ["Lan", -1], ["Tú", -1]],
    [["Tú", 3], ["Nam", -1], ["Hùng", 2], ["Lan", -3], ["Minh", -1]],
  ];
  for (const deltas of rounds) {
    await mock(page, "ghi ván", deltas);
    await say(page, "ghi ván");
    await page.getByRole("button", { name: "Ghi", exact: true }).click();
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: "screenshots/5-table.png", fullPage: true });
});

/** Done-evidence C-003 + C-004. */
test("C-003/C-004 done-evidence", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await installFakeSpeech(page);
  await page.goto("/");
  await page.getByRole("button", { name: "+ Thêm người chơi" }).click();
  for (const [i, name] of ["Nam", "Hùng", "Lan", "Tú", "Minh"].entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();

  for (let i = 0; i < 10; i += 1) {
    await mock(page, "ghi ván", [["Nam", 2], ["Hùng", -1], ["Lan", -1], ["Tú", 1], ["Minh", -1]]);
    await say(page, "ghi ván");
    await page.getByRole("button", { name: "Ghi", exact: true }).click();
    await page.waitForTimeout(80);
  }
  // C-003: không fullPage — chứng minh đúng những gì thấy trong 1 màn hình.
  await page.screenshot({ path: "screenshots/9-single-table.png" });

  // Sửa ô tại chỗ: bấm vào ô mở hàng ra sửa.
  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByLabel("Điểm của Nam").fill("4");
  await page.screenshot({ path: "screenshots/10-edit-cell.png" });
  await page.getByRole("button", { name: "Hủy", exact: true }).click();

  // Nhật ký một ván đã sửa.
  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByLabel("Điểm của Nam").fill("4");
  await page.getByLabel("Điểm của Tú").fill("-1");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await page.getByRole("button", { name: "Lịch sử ván 1" }).click();
  await page.screenshot({ path: "screenshots/11-history.png" });
  await page.getByRole("button", { name: "Đóng" }).click();
  await page.screenshot({ path: "screenshots/12-final.png" });
});
