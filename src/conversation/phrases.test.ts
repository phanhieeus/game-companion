import { describe, expect, it } from "vitest";
import { confirmRoundPrompt, describeScoreboard, readConfirmation } from "./phrases";

describe("confirmRoundPrompt", () => {
  it("đọc lại theo thứ tự điểm giảm dần", () => {
    expect(
      confirmRoundPrompt([
        { name: "Hùng", delta: -1 },
        { name: "Nam", delta: 3 },
        { name: "Lan", delta: -1 },
        { name: "Tú", delta: -1 },
      ]),
    ).toBe("Nam +3, Hùng -1, Lan -1, Tú -1. Ghi ván này nhé?");
  });
});

describe("describeScoreboard", () => {
  const rows = (...pairs: [string, number][]) =>
    pairs.map(([name, total], i) => ({
      playerId: `p${i}`,
      name,
      total,
      rank: i + 1,
    }));

  it("nói rõ ai dẫn đầu", () => {
    const text = describeScoreboard({
      rows: rows(["Nam", 12], ["Tú", 4], ["Lan", -3]),
      roundsPlayed: 5,
    });
    expect(text).toContain("Nam dẫn với 12 điểm");
    expect(text).toContain("Tú 4");
  });

  it("gộp lại khi nhiều người bằng điểm dẫn đầu", () => {
    const text = describeScoreboard({
      rows: rows(["Nam", 5], ["Tú", 5], ["Lan", -10]),
      roundsPlayed: 3,
    });
    expect(text).toContain("Nam và Tú đang bằng nhau với 5 điểm");
  });

  it("nói chưa có ván nào khi phiên mới bắt đầu", () => {
    expect(
      describeScoreboard({ rows: rows(["Nam", 0], ["Tú", 0]), roundsPlayed: 0 }),
    ).toContain("Chưa ghi ván nào");
  });
});

describe("readConfirmation", () => {
  it.each(["ừ", "đúng rồi", "ok", "Được", "chuẩn", "ghi đi"])(
    "hiểu %s là đồng ý",
    (text) => expect(readConfirmation(text)).toBe("yes"),
  );

  it.each(["không", "sai rồi", "thôi", "đừng ghi"])(
    "hiểu %s là từ chối",
    (text) => expect(readConfirmation(text)).toBe("no"),
  );

  it("hiểu 'không đúng' là từ chối chứ không phải đồng ý", () => {
    expect(readConfirmation("không đúng")).toBe("no");
  });

  it("trả unclear khi câu nói là nội dung sửa lại", () => {
    expect(readConfirmation("Hùng trừ một thôi")).toBe("unclear");
  });
});
