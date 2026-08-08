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
