import type { Page } from "@playwright/test";

/**
 * Cài SpeechRecognition giả TRƯỚC khi trang load.
 *
 * src/voice/speech.ts đọc `window.SpeechRecognition ?? window.webkitSpeechRecognition`,
 * nên chỉ cần định nghĩa sẵn là app dùng bản giả — không phải sửa một dòng code
 * production nào. Nhờ vậy test đi đúng qua state machine thật.
 *
 * Cũng chặn luôn speechSynthesis để test không phụ thuộc giọng đọc có sẵn.
 */
export async function installFakeSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      SpeechRecognition: unknown;
      __nextTranscript?: string;
      __spoken: string[];
    };

    w.__spoken = [];

    class FakeSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      private timer: number | undefined;

      start(): void {
        // Trả kết quả bất đồng bộ, giống API thật.
        this.timer = window.setTimeout(() => {
          const text = w.__nextTranscript ?? "";
          if (!text) {
            this.onerror?.({ error: "no-speech" });
            this.onend?.();
            return;
          }
          this.onresult?.({
            results: Object.assign(
              [Object.assign([{ transcript: text }], { isFinal: true })],
              { length: 1 },
            ),
          });
          this.onend?.();
        }, 10);
      }

      stop(): void {
        // API thật kết thúc lượt khi stop; ở đây start() đã hẹn giờ sẵn.
      }

      abort(): void {
        if (this.timer) window.clearTimeout(this.timer);
        this.onend = null;
      }
    }

    w.SpeechRecognition = FakeSpeechRecognition;

    // Ghi lại câu agent đọc để test kiểm tra được, không cần loa.
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        speak: (u: { text: string }) => w.__spoken.push(u.text),
        cancel: () => {},
        getVoices: () => [],
        addEventListener: () => {},
      },
    });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance =
      class {
        text: string;
        lang = "";
        rate = 1;
        voice = null;
        constructor(text: string) {
          this.text = text;
        }
      };
  });
}

/** Đặt câu sẽ "nghe được" ở lượt nói tiếp theo. */
export async function setTranscript(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    (window as unknown as { __nextTranscript: string }).__nextTranscript = t;
  }, text);
}

/** Nhấn giữ nút Voice rồi nhả — đúng như thao tác thật. */
export async function say(page: Page, text: string): Promise<void> {
  await setTranscript(page, text);
  const button = page.getByRole("button", { name: /Nhấn giữ để nói|Đang nghe/ });
  await button.dispatchEvent("pointerdown");
  await button.dispatchEvent("pointerup");
}

export async function spokenLines(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __spoken: string[] }).__spoken,
  );
}
