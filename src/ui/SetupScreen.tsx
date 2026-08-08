import { useState } from "react";
import { MAX_PLAYERS, MIN_PLAYERS } from "../../shared/types";
import {
  currentOrigin,
  isSecureOrigin,
  isSpeechRecognitionSupported,
} from "../voice/speech";

interface Props {
  onCreate: (players: string[], meName: string | null) => void;
  error: string | null;
}

export function SetupScreen({ onCreate, error }: Props) {
  const [names, setNames] = useState<string[]>(["", "", "", ""]);
  const [meIndex, setMeIndex] = useState(0);

  const filled = names.map((n) => n.trim()).filter(Boolean);
  const canStart =
    filled.length >= MIN_PLAYERS && filled.length === new Set(filled).size;

  const setName = (index: number, value: string) => {
    setNames((prev) => prev.map((n, i) => (i === index ? value : n)));
  };

  return (
    <div className="setup">
      <div>
        <h2>Phiên chơi mới</h2>
        <p>
          Nhập tên {MIN_PLAYERS}–{MAX_PLAYERS} người chơi. Tính điểm trực tiếp,
          tổng mỗi ván bằng 0.
        </p>
      </div>

      {!isSpeechRecognitionSupported() && (
        <div className="warning">
          Trình duyệt này không hỗ trợ nhận dạng giọng nói. Mở bằng Chrome trên
          Android hoặc máy tính để dùng được giọng nói.
        </div>
      )}

      {isSpeechRecognitionSupported() && !isSecureOrigin() && (
        <div className="warning">
          Đang mở qua <code>{currentOrigin()}</code>. Chrome chỉ cho dùng micro
          trên <code>https</code> hoặc <code>localhost</code>, nên sẽ không hiện
          hộp xin quyền và nút nói sẽ không chạy.
          <br />
          <br />
          Trên máy tính: mở <code>http://localhost:5173</code>.
          <br />
          Trên điện thoại: xem mục "Test trên điện thoại" trong README.
        </div>
      )}

      {error && <div className="warning">{error}</div>}

      {names.map((name, index) => (
        <div className="player-input" key={index}>
          <input
            value={name}
            onChange={(e) => setName(index, e.target.value)}
            placeholder={`Người chơi ${index + 1}`}
            autoComplete="off"
            aria-label={`Tên người chơi ${index + 1}`}
          />
          <button
            type="button"
            className="remove"
            onClick={() => setMeIndex(index)}
            aria-pressed={meIndex === index}
            title="Đây là tôi (người cầm máy)"
          >
            {meIndex === index ? "★ tôi" : "☆"}
          </button>
          {names.length > MIN_PLAYERS && (
            <button
              type="button"
              className="remove"
              onClick={() => {
                setNames((prev) => prev.filter((_, i) => i !== index));
                if (meIndex >= index && meIndex > 0) setMeIndex(meIndex - 1);
              }}
              aria-label={`Xoá người chơi ${index + 1}`}
            >
              ✕
            </button>
          )}
        </div>
      ))}

      {names.length < MAX_PLAYERS && (
        <button
          type="button"
          className="ghost"
          onClick={() => setNames((prev) => [...prev, ""])}
        >
          + Thêm người chơi
        </button>
      )}

      <button
        type="button"
        className="primary"
        disabled={!canStart}
        onClick={() => onCreate(filled, names[meIndex]?.trim() || null)}
      >
        Bắt đầu chơi
      </button>

      {!canStart && filled.length >= MIN_PLAYERS && (
        <p>Tên người chơi không được trùng nhau.</p>
      )}
    </div>
  );
}
