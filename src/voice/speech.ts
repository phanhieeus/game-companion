/**
 * Web Speech API — STT và TTS, miễn phí, không cần API key (decision 0002).
 *
 * Push-to-talk: chỉ thu âm khi người dùng giữ nút. Không nghe liên tục.
 * Xem docs/product/voice-pipeline.md.
 */

const LANG = "vi-VN";

// Chrome/Edge dùng tiền tố webkit; TypeScript DOM lib chưa khai báo sẵn.
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== undefined;
}

/**
 * Chrome không hiện hộp xin quyền micro trên origin không an toàn — nó từ chối
 * im lặng. Kiểm trước để cảnh báo, thay vì để người dùng bấm rồi ngồi đoán.
 */
export function isSecureOrigin(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

export interface Listener {
  stop(): void;
  abort(): void;
}

export interface ListenCallbacks {
  /** Kết quả tạm — hiện lên màn hình để người dùng thấy máy đang nghe gì. */
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

/**
 * Chrome chỉ cho dùng micro trên "secure context": https, http://localhost,
 * hoặc http://127.0.0.1. Mở qua IP LAN (http://192.168.x.x) thì Chrome TỪ CHỐI
 * THẲNG, không hiện hộp xin quyền — nên người dùng tưởng app hỏng chứ không
 * biết là do địa chỉ. Nói rõ ra thay vì báo lỗi chung chung.
 */
function insecureOriginHint(): string {
  return window.isSecureContext
    ? ""
    : ` Trang đang mở qua ${window.location.protocol}//${window.location.hostname} — Chrome chỉ cho dùng micro trên https hoặc localhost.`;
}

const ERROR_MESSAGES: Record<string, string> = {
  "no-speech": "Mình không nghe thấy gì, nói lại giúp nhé.",
  "audio-capture":
    "Không truy cập được micro. Kiểm tra xem máy có micro và app khác có đang chiếm không.",
  "not-allowed": "Trình duyệt chưa cho phép dùng micro.",
  // Lỗi hay gặp nhất khi mở bằng IP LAN.
  "service-not-allowed": "Trình duyệt không cho dùng nhận dạng giọng nói ở đây.",
  network: "Mất kết nối mạng nên không nhận dạng được giọng nói.",
  aborted: "",
};

export function startListening(callbacks: ListenCallbacks): Listener | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    callbacks.onError(
      "Trình duyệt này không hỗ trợ nhận dạng giọng nói. Dùng Chrome trên Android hoặc máy tính.",
    );
    return null;
  }

  const recognition = new Ctor();
  recognition.lang = LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let finalText = "";
  let settled = false;
  /**
   * Phân biệt "người dùng tự huỷ" với "trình duyệt tự huỷ".
   *
   * Cả hai đều báo error = "aborted". Trước đây gộp làm một và im lặng bỏ qua,
   * nên khi trình duyệt tự huỷ (ví dụ có recognition khác chen vào) thì KHÔNG
   * callback nào chạy — UI kẹt ở "Đang nghe" vĩnh viễn, nút không dùng lại được.
   */
  let userAborted = false;

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) finalText += text;
      else interim += text;
    }
    if (interim) callbacks.onPartial?.(interim);
  };

  recognition.onerror = (event) => {
    if (settled) return;
    settled = true;
    // Người dùng tự huỷ thì im lặng; trình duyệt tự huỷ thì phải báo, nếu không
    // sẽ không có gì đưa state về idle.
    if (event.error === "aborted" && userAborted) return;

    const message =
      event.error === "aborted"
        ? "Nhận dạng bị ngắt giữa chừng, thử lại nhé."
        : ERROR_MESSAGES[event.error];

    if (message !== undefined && message !== "") {
      const base = message ?? `Lỗi nhận dạng giọng nói (${event.error}).`;
      const needsOriginHint =
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture";
      callbacks.onError(base + (needsOriginHint ? insecureOriginHint() : ""));
    }
  };

  recognition.onend = () => {
    if (settled) return;
    settled = true;
    const text = finalText.trim();
    if (text) callbacks.onFinal(text);
    else callbacks.onError("Mình chưa nghe rõ, nói lại giúp nhé.");
  };

  try {
    recognition.start();
  } catch {
    callbacks.onError("Không khởi động được micro.");
    return null;
  }

  return {
    stop: () => recognition.stop(),
    abort: () => {
      userAborted = true;
      settled = true;
      recognition.abort();
    },
  };
}

let vietnameseVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (vietnameseVoice) return vietnameseVoice;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  vietnameseVoice = voices.find((v) => v.lang?.startsWith("vi")) ?? null;
  return vietnameseVoice;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Đọc câu trả lời. Cắt câu đang đọc dở nếu có câu mới — người dùng đã nói tiếp.
 *
 * KHÔNG AI GỌI HÀM NÀY từ 2026-08-08 (C-020, ADR 18) — đây là TẮT, không phải
 * bỏ. Operator đo trên điện thoại thật: nhận giọng nói tiếng Việt thì đạt, còn
 * giọng đọc ra thì sai ngữ điệu, nghe giữa ván bài khó chịu hơn là đọc bằng mắt.
 * Giữ nguyên phần thu âm ở trên; bật lại chỗ này khi có giọng đọc nghe được, chỉ
 * cần gọi lại từ `useConversation.ts`. Đừng xoá — xoá rồi thì lần sau phải viết
 * lại cả phần chọn giọng tiếng Việt.
 */
export function speak(text: string): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANG;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
}

// Danh sách giọng nạp bất đồng bộ trên một số trình duyệt.
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    vietnameseVoice = null;
    pickVoice();
  });
}
