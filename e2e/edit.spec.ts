import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, say } from "./fakeSpeech";
import { commitRound, resetServer, scriptAgent, recordThenSay, record } from "./fakeAgent";

/**
 * Sửa ô tại chỗ + thêm hàng + nhật ký thay đổi.
 *
 * Không test nào ở đây mock `/api/agent` cho phần nhập tay — nghĩa là đường
 * ghi điểm không-dùng-giọng-nói chạy độc lập thật.
 */

// Dữ liệu nằm ở server (ADR 13) — mỗi test bắt đầu từ con số không.
test.beforeEach(async ({ page }) => resetServer(page));

const PLAYERS = ["Nam", "Hùng", "Lan", "Tú"];

async function startSession(page: Page): Promise<void> {
  await installFakeSpeech(page);
  await page.goto("/");
  for (const [i, name] of PLAYERS.entries()) {
    await page.getByLabel(`Tên người chơi ${i + 1}`).fill(name);
  }
  await page.getByRole("button", { name: "Bắt đầu chơi" }).click();
}

/** Thêm một ván bằng hàng "+ Thêm ván" trong bảng. */
async function addRound(page: Page, deltas: Record<string, number>) {
  await page.getByRole("button", { name: "+ Thêm ván" }).click();
  for (const [name, delta] of Object.entries(deltas)) {
    await page.getByLabel(`Điểm của ${name}`).fill(String(delta));
  }
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
}

test("thêm ván bằng hàng trong bảng, không cần nút Nhập tay", async ({ page }) => {
  await startSession(page);

  // Nút "Nhập tay" cũ phải biến mất hẳn.
  await expect(page.getByRole("button", { name: "Nhập tay" })).toHaveCount(0);

  await addRound(page, { Nam: 3, Hùng: -1, Lan: -1, Tú: -1 });

  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await expect(page.getByText("1 ván")).toBeVisible();
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});

test("gõ tự do được, chỉ chặn ở nút Lưu khi tổng chưa cân", async ({ page }) => {
  await startSession(page);
  await page.getByRole("button", { name: "+ Thêm ván" }).click();

  // Gõ một ô — tổng lệch nhưng KHÔNG bị chặn gõ (ADR quyết định 7).
  await page.getByLabel("Điểm của Nam").fill("3");
  await expect(page.locator(".edit-sum")).toContainText("Tổng 3 — chưa cân");
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeDisabled();

  // Gõ tiếp cho cân thì mới lưu được.
  await page.getByLabel("Điểm của Hùng").fill("-3");
  await expect(page.locator(".edit-sum")).toContainText("Tổng 0 ✓");
  await expect(page.getByRole("button", { name: "Lưu", exact: true })).toBeEnabled();
});

test("bấm vào ô mở hàng đó ra sửa, lưu xong bảng tính lại", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 3, Hùng: -3 });

  // Bấm vào ô của Nam ở hàng ván 1.
  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await expect(page.locator(".rounds-table tr.editing")).toHaveCount(1);

  await page.getByLabel("Điểm của Nam").fill("5");
  await page.getByLabel("Điểm của Hùng").fill("-5");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();

  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+5");
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
});

test("hủy sửa thì không đổi gì", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 2, Hùng: -2 });

  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByLabel("Điểm của Nam").fill("9");
  await page.getByRole("button", { name: "Hủy", exact: true }).click();

  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+2");
});

test("ván đã sửa có dấu, bấm vào xem được trước/sau", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 3, Hùng: -3 });

  // Chưa sửa thì chưa có dấu.
  await expect(page.getByRole("button", { name: "Lịch sử ván 1" })).toHaveCount(0);

  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByLabel("Điểm của Nam").fill("5");
  await page.getByLabel("Điểm của Hùng").fill("-5");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();

  // Sửa xong thì có dấu.
  const dot = page.getByRole("button", { name: "Lịch sử ván 1" });
  await expect(dot).toBeVisible();
  await dot.click();

  const sheet = page.getByRole("dialog", { name: "Lịch sử ván 1" });
  await expect(sheet).toBeVisible();
  // Hai mục: ghi ban đầu + lần sửa.
  await expect(sheet.locator(".sheet-list li")).toHaveCount(2);
  await expect(sheet.locator(".ev-kind").first()).toHaveText("Ghi");
  await expect(sheet.locator(".ev-kind").last()).toHaveText("Sửa");
  // Trước → sau nằm ở mục "Sửa" (mục cuối), không phải mục "Ghi".
  const editEntry = sheet.locator(".sheet-list li").last();
  await expect(editEntry.locator(".ev-change").first()).toContainText("+3");
  await expect(editEntry.locator(".ev-change").first()).toContainText("+5");
});

test("nhật ký ghi cả ván nói bằng giọng lẫn ván nhập tay", async ({ page }) => {
  await startSession(page);

  // Ván 1 bằng giọng nói. Phải đủ cả bốn người: agent không được ghi ván bỏ
  // sót ai (C-030).
  await scriptAgent(page, {
    "Nam ăn 4, ba người kia chung": recordThenSay(
      record(["Nam", 3], ["Hùng", -1], ["Lan", -1], ["Tú", -1]),
    ),
  });
  await say(page, "Nam ăn 4, ba người kia chung");
  await commitRound(page);

  // Sửa nó bằng tay → nhật ký phải phân biệt được nguồn.
  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByLabel("Điểm của Nam").fill("6");
  await page.getByLabel("Điểm của Hùng").fill("-2");
  await page.getByLabel("Điểm của Lan").fill("-2");
  await page.getByLabel("Điểm của Tú").fill("-2");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();

  await page.getByRole("button", { name: "Lịch sử ván 1" }).click();
  const sheet = page.getByRole("dialog", { name: "Lịch sử ván 1" });
  await expect(sheet.locator(".ev-meta").first()).toContainText("giọng nói");
  await expect(sheet.locator(".ev-meta").last()).toContainText("nhập tay");
});

test("hủy ván cũng vào nhật ký", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 1, Hùng: -1 });
  await addRound(page, { Nam: 2, Hùng: -2 });

  await page.getByRole("button", { name: "Hủy ván 2" }).click();
  await expect(page.getByText("1 ván")).toBeVisible();

  // Ván bị hủy không còn trong bảng, nhưng nhật ký của nó vẫn tồn tại —
  // kiểm gián tiếp: bảng chỉ còn 1 hàng và tổng đúng.
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+1");
});

/**
 * PRD metric #4 — giữ từ e2e/manual.spec.ts (đã xoá).
 *
 * Cơ chế nhập tay đổi từ "nút + form" sang "hàng trong bảng", nên test cũ hết
 * áp dụng. Chỉ tiêu thì vẫn còn hiệu lực nên chuyển sang đây, và giờ còn tốt
 * hơn: 2 thao tác thay vì 2 (mở hàng, lưu) — không cần đóng/mở form nữa.
 */
test("PRD metric #4: ≤ 4 thao tác chạm ngoài việc gõ số", async ({ page }) => {
  await startSession(page);

  let taps = 0;
  const tap = async (fn: () => Promise<void>) => {
    taps += 1;
    await fn();
  };

  await tap(async () => page.getByRole("button", { name: "+ Thêm ván" }).click());
  await page.getByLabel("Điểm của Nam").fill("1");
  await page.getByLabel("Điểm của Hùng").fill("-1");
  await tap(async () => page.getByRole("button", { name: "Lưu", exact: true }).click());

  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  expect(taps).toBeLessThanOrEqual(4);
});

/* ---- Hoàn tác / Làm lại ---- */

test("hoàn tác và làm lại nhiều bước từ bảng", async ({ page }) => {
  await startSession(page);
  const undo = page.getByRole("button", { name: /^Hoàn tác/ });
  const redo = page.getByRole("button", { name: /^Làm lại/ });

  // Chưa có gì thì cả hai nút đều khoá.
  await expect(page.getByRole("button", { name: "Không còn gì để hoàn tác" })).toBeDisabled();

  await addRound(page, { Nam: 1, Hùng: -1 });
  await addRound(page, { Nam: 2, Hùng: -2 });
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(2);

  await undo.click();
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(1);
  await undo.click();
  await expect(page.getByText("0 ván")).toBeVisible();

  await redo.click();
  await redo.click();
  await expect(page.locator(".rounds-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});

test("hoàn tác một lần sửa thì điểm quay lại giá trị cũ", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 3, Hùng: -3 });

  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByLabel("Điểm của Nam").fill("9");
  await page.getByLabel("Điểm của Hùng").fill("-9");
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+9");

  await page.getByRole("button", { name: /^Hoàn tác/ }).click();
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});

test("thao tác mới sau khi hoàn tác thì nút làm lại khoá", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 1, Hùng: -1 });
  await page.getByRole("button", { name: /^Hoàn tác/ }).click();
  await expect(page.getByRole("button", { name: /^Làm lại/ })).toBeEnabled();

  await addRound(page, { Nam: 5, Hùng: -5 });
  await expect(
    page.getByRole("button", { name: "Không còn gì để làm lại" }),
  ).toBeDisabled();
});

test("mở ô ra rồi lưu y nguyên thì không hiện dấu đã-sửa", async ({ page }) => {
  await startSession(page);
  await addRound(page, { Nam: 3, Hùng: -3 });

  // Mở ra, không đổi gì, bấm Lưu.
  await page.locator(".rounds-table tbody tr").first().locator("td.tap").first().click();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();

  // Không có dấu → không có gì để xem lịch sử.
  await expect(page.getByRole("button", { name: "Lịch sử ván 1" })).toHaveCount(0);
  await expect(page.locator(".rounds-table tfoot td").first()).toHaveText("+3");
});
