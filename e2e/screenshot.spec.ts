import { test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";

/** Chụp màn hình để xem UI thật, không đoán. Chạy: npx playwright test screenshot */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];

async function mock(page: Page, deltas: [string, number][]) {
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
          entries: deltas.map(([name, delta]) => ({
            player_id: id(name),
            delta,
          })),
        },
      }),
    });
  });
}

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
  await mock(page, [["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]]);
  await say(page, "Nam ăn 3, ba người kia mỗi người chung 1");
  await page.screenshot({ path: "screenshots/3-confirm.png", fullPage: true });
  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await mock(page, [["Tú", 5], ["Nam", -2], ["Hùng", -2], ["Lan", -1]]);
  await say(page, "Tú ăn 5");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "screenshots/4-played.png", fullPage: true });
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
    await mock(page, deltas);
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
    await mock(page, [["Nam", 2], ["Hùng", -1], ["Lan", -1], ["Tú", 1], ["Minh", -1]]);
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
});
