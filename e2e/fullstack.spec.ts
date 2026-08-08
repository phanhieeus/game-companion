import { expect, test } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { resetServer, scriptAgent, recordThenSay, record } from "./fakeAgent";

/**
 * Done-evidence C-013: dữ liệu chỉ có MỘT bản, và nó nằm ở server.
 *
 * Ảnh chụp màn hình và `curl` cùng lúc phải khớp nhau; xoá ở server thì màn
 * hình mất theo. Đó là thứ bản localStorage không thể chứng minh.
 */
test("C-013 done-evidence: client là UI thuần, dữ liệu ở server", async ({
  page,
  request,
}) => {
  await resetServer(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await installFakeSpeech(page);

  const cau = "Nam ăn 3, ba người kia mỗi người chung 1";
  await scriptAgent(page, {
    [cau]: recordThenSay(record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1])),
  });

  await page.goto("/");
  for (const [i, n] of ["Nam", "Hùng", "Lan", "Tú"].entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(n);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();

  await say(page, cau);
  await page.getByRole("button", { name: "Ghi", exact: true }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  // Cùng lúc đó, server nói y hệt.
  const api = await request.get("http://localhost:8788/api/sessions/active");
  const body = (await api.json()) as {
    session: { id: string; rounds: unknown[] };
    scoreboard: { rows: { name: string; total: number }[] };
  };
  expect(body.session.rounds).toHaveLength(1);
  expect(body.scoreboard.rows.find((r) => r.name === "Nam")?.total).toBe(3);
  console.log("SERVER:", JSON.stringify(body.scoreboard.rows));

  await page.screenshot({ path: "screenshots/14-fullstack.png", fullPage: true });

  // Xoá ở server → tải lại → app về màn hình tạo phiên. Client không giữ bản nào.
  await resetServer(page);
  await page.reload();
  await expect(page.getByRole("button", { name: "Bắt đầu chơi" })).toBeVisible();
});
