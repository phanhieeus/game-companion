import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say, spokenLines } from "./fakeSpeech";

/**
 * Luồng end-to-end với intent giả lập.
 *
 * /api/interpret bị mock để test tất định và không đốt quota Gemini. Phần
 * "Gemini có hiểu đúng tiếng Việt không" được kiểm ở gemini.spec.ts.
 * Ở đây kiểm phần còn lại: xác nhận, validate, ghi điểm, tính lại bảng điểm.
 */

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];

/** Trả intent cố định theo câu nói, thay cho LLM. */
async function mockIntents(
  page: Page,
  reply: (transcript: string, players: { id: string; name: string }[]) => unknown,
): Promise<void> {
  await page.route("**/api/interpret", async (route) => {
    const body = route.request().postDataJSON() as {
      transcript: string;
      context: { players: { id: string; name: string }[] };
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(reply(body.transcript, body.context.players)),
    });
  });
}

function idOf(players: { id: string; name: string }[], name: string): string {
  const found = players.find((p) => p.name === name);
  if (!found) throw new Error(`Không có người chơi tên ${name}`);
  return found.id;
}

async function startSession(page: Page): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");

  for (const [index, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${index + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
  await expect(page.getByRole("button", { name: /Nhấn giữ để nói/ })).toBeVisible();
}

/** Đọc bảng điểm đang hiện trên màn hình. */
async function readScoreboard(page: Page): Promise<Record<string, number>> {
  const rows = page.locator(".scoreboard .row");
  const result: Record<string, number> = {};
  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i);
    // Ô tên có thể kèm nhãn "· tôi" cho người cầm máy — bỏ đi khi so sánh.
    const name = (await row.locator(".name").innerText())
      .replace(/·\s*tôi\s*$/u, "")
      .trim();
    const total = (await row.locator(".total").innerText()).trim();
    result[name] = Number(total.replace("+", ""));
  }
  return result;
}

test("tạo phiên rồi hiện bảng điểm 4 người, tất cả 0 điểm", async ({ page }) => {
  await startSession(page);
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
  await expect(page.getByText("0 ván")).toBeVisible();
});

test("D1: nói ghi điểm, xác nhận, bảng điểm cập nhật", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (_t, players) => ({
    intent: "record_round",
    args: {
      entries: [
        { player_id: idOf(players, "Nam"), delta: 3 },
        { player_id: idOf(players, "Hùng"), delta: -1 },
        { player_id: idOf(players, "Lan"), delta: -1 },
        { player_id: idOf(players, "Tú"), delta: -1 },
      ],
    },
  }));

  await say(page, "Nam ăn 3, ba người kia mỗi người chung 1");

  // Phải hỏi xác nhận TRƯỚC khi ghi.
  await expect(page.getByText("Nam +3, Hùng -1, Lan -1, Tú -1. Ghi ván này nhé?")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });

  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });
  expect((await spokenLines(page)).at(-1)).toContain("Xong ván 1");
});

test("từ chối xác nhận thì không ghi gì", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (_t, players) => ({
    intent: "record_round",
    args: {
      entries: [
        { player_id: idOf(players, "Nam"), delta: 2 },
        { player_id: idOf(players, "Hùng"), delta: -2 },
      ],
    },
  }));

  await say(page, "Nam ăn 2, Hùng chung 2");
  await expect(page.getByText(/Ghi ván này nhé\?/)).toBeVisible();
  await page.getByRole("button", { name: "Bỏ qua" }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

test("nói 'ừ' để xác nhận bằng giọng nói, không cần bấm nút", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (_t, players) => ({
    intent: "record_round",
    args: {
      entries: [
        { player_id: idOf(players, "Lan"), delta: 4 },
        { player_id: idOf(players, "Tú"), delta: -4 },
      ],
    },
  }));

  await say(page, "Lan ăn 4 của Tú");
  await expect(page.getByText(/Ghi ván này nhé\?/)).toBeVisible();

  await say(page, "ừ");

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toMatchObject({ Lan: 4, Tú: -4 });
});

test("tổng khác 0 bị chặn, không ghi và có báo lỗi", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (_t, players) => ({
    intent: "record_round",
    args: {
      // Cố tình sai: tổng = +2, giống khi STT nghe nhầm số.
      entries: [
        { player_id: idOf(players, "Nam"), delta: 3 },
        { player_id: idOf(players, "Hùng"), delta: -1 },
      ],
    },
  }));

  await say(page, "Nam ăn 3, Hùng chung 1");

  await expect(page.getByText(/Tổng điểm của ván phải bằng 0/)).toBeVisible();
  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

test("hỏi bảng điểm thì trả lời thẳng, không hỏi xác nhận", async ({ page }) => {
  await startSession(page);

  await mockIntents(page, (transcript, players) =>
    transcript === "ai đang dẫn"
      ? { intent: "query_scoreboard", args: {} }
      : {
          intent: "record_round",
          args: {
            entries: [
              { player_id: idOf(players, "Nam"), delta: 5 },
              { player_id: idOf(players, "Hùng"), delta: -5 },
            ],
          },
        },
  );

  await say(page, "Nam ăn 5 của Hùng");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await say(page, "ai đang dẫn");

  await expect(page.getByRole("button", { name: "Ghi", exact: true })).toBeHidden();
  expect((await spokenLines(page)).at(-1)).toContain("Nam dẫn với 5 điểm");
});

test("hủy ván thì bảng điểm quay lại như trước", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (transcript, players) =>
    transcript === "nhầm rồi hủy ván vừa nãy"
      ? { intent: "undo_round", args: {} }
      : {
          intent: "record_round",
          args: {
            entries: [
              { player_id: idOf(players, "Nam"), delta: 3 },
              { player_id: idOf(players, "Hùng"), delta: -3 },
            ],
          },
        },
  );

  await say(page, "Nam ăn 3 của Hùng");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await say(page, "nhầm rồi hủy ván vừa nãy");
  await expect(page.getByText(/Hủy ván 1 nhé\?/)).toBeVisible();
  await page.getByRole("button", { name: "Ghi", exact: true }).click();

  await expect(page.getByText("0 ván")).toBeVisible();
  expect(await readScoreboard(page)).toEqual({ Nam: 0, Hùng: 0, Lan: 0, Tú: 0 });
});

test("câu hỏi lại (clarify) không ghi gì và chờ trả lời", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, () => ({
    intent: "clarify",
    args: { question: "6 điểm này ai chung? Chia đều 3 người còn lại nhé?" },
  }));

  await say(page, "Nam thắng 6");

  await expect(page.getByText("6 điểm này ai chung?", { exact: false })).toBeVisible();
  await expect(page.getByText("0 ván")).toBeVisible();
});

test("tắt xác nhận trong cài đặt thì ghi thẳng", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (_t, players) => ({
    intent: "record_round",
    args: {
      entries: [
        { player_id: idOf(players, "Tú"), delta: 7 },
        { player_id: idOf(players, "Lan"), delta: -7 },
      ],
    },
  }));

  await page.getByRole("button", { name: "Cài đặt" }).click();
  await page.getByRole("button", { name: "Đang bật" }).click();
  await expect(page.getByRole("button", { name: "Đang tắt" })).toBeVisible();

  await say(page, "Tú ăn 7 của Lan");

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toMatchObject({ Tú: 7, Lan: -7 });
});

test("mở lại app vẫn còn phiên đang chơi", async ({ page }) => {
  await startSession(page);
  await mockIntents(page, (_t, players) => ({
    intent: "record_round",
    args: {
      entries: [
        { player_id: idOf(players, "Nam"), delta: 9 },
        { player_id: idOf(players, "Hùng"), delta: -9 },
      ],
    },
  }));

  await say(page, "Nam ăn 9 của Hùng");
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  await page.reload();

  await expect(page.getByText("1 ván")).toBeVisible();
  expect(await readScoreboard(page)).toMatchObject({ Nam: 9, Hùng: -9 });
});

test("lỗi từ proxy được báo ra, không ghi gì", async ({ page }) => {
  await startSession(page);
  await page.route("**/api/interpret", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Hết quota Gemini hôm nay." }),
    }),
  );

  await say(page, "Nam ăn 3");

  await expect(page.getByText("Hết quota Gemini hôm nay.")).toBeVisible();
  await expect(page.getByText("0 ván")).toBeVisible();
});
