import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";

/** T·C·R — các affordance thêm vào sau khi chạy /tcr-apply. */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];

async function startSession(page: Page): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");
  for (const [i, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

async function mockRecord(page: Page): Promise<void> {
  await page.route("**/api/interpret", async (route) => {
    const body = route.request().postDataJSON() as {
      context: { players: { id: string; name: string }[] };
    };
    const id = (n: string) =>
      body.context.players.find((p) => p.name === n)!.id;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: "record_round",
        args: {
          entries: [
            { player_id: id("Nam"), delta: 3 },
            { player_id: id("Hùng"), delta: -1 },
            { player_id: id("Lan"), delta: -1 },
            { player_id: id("Tú"), delta: -1 },
          ],
        },
      }),
    });
  });
}

test("T: ván đề xuất hiện thành con số, không chỉ đọc lên", async ({ page }) => {
  await startSession(page);
  await mockRecord(page);
  await say(page, "Nam ăn 3, ba người kia mỗi người chung 1");

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

  await say(page, "Nam ăn 3, ba người kia mỗi người chung 1");
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
  await say(page, "Nam ăn 3, ba người kia mỗi người chung 1");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await page.getByRole("button", { name: "Hủy ván 1" }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  await expect(page.getByText("Chưa ghi ván nào.")).toBeVisible();
});

test("R: lỗi thì thử lại được mà không phải nói lại", async ({ page }) => {
  await startSession(page);

  // Lần đầu hỏng, lần sau thành công — mô phỏng mạng chập chờn.
  let attempt = 0;
  await page.route("**/api/interpret", async (route) => {
    attempt += 1;
    if (attempt === 1) {
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Mất kết nối." }),
      });
    }
    const body = route.request().postDataJSON() as {
      context: { players: { id: string; name: string }[] };
    };
    const id = (n: string) =>
      body.context.players.find((p) => p.name === n)!.id;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: "record_round",
        args: {
          entries: [
            { player_id: id("Nam"), delta: 2 },
            { player_id: id("Hùng"), delta: -2 },
          ],
        },
      }),
    });
  });

  await say(page, "Nam ăn 2 của Hùng");
  await expect(page.getByText("Mất kết nối.")).toBeVisible();

  // Nút thử lại dùng lại câu cũ — không đụng tới micro.
  await page.getByRole("button", { name: /Thử lại câu vừa nói/ }).click();

  await expect(page.locator(".proposal")).toBeVisible();
  expect(attempt).toBe(2);
});

test("R: không hiện nút thử lại khi lỗi là do người dùng nói sai luật", async ({
  page,
}) => {
  await startSession(page);
  await page.route("**/api/interpret", async (route) => {
    const body = route.request().postDataJSON() as {
      context: { players: { id: string; name: string }[] };
    };
    const id = (n: string) =>
      body.context.players.find((p) => p.name === n)!.id;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        intent: "record_round",
        // Tổng = +2, sai luật zero-sum. Thử lại y hệt cũng sẽ sai.
        args: {
          entries: [
            { player_id: id("Nam"), delta: 3 },
            { player_id: id("Hùng"), delta: -1 },
          ],
        },
      }),
    });
  });

  await say(page, "Nam ăn 3, Hùng chung 1");
  await expect(page.getByText(/Tổng điểm của ván phải bằng 0/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Thử lại câu vừa nói/ }),
  ).toBeHidden();
});
