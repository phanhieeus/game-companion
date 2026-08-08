"""Nói chuyện với Gemini — chỗ DUY NHẤT trong hệ thống biết Gemini tồn tại.

Tách riêng khỏi vòng lặp ReAct (`loop.py`) để vòng lặp không biết gì về HTTP hay
hình dạng request của một nhà cung cấp cụ thể. Nhờ vậy test vòng lặp chỉ cần đưa
vào một hàm model giả, không phải giả lập tầng mạng.

API key nằm ở đây và không bao giờ xuống trình duyệt (decision 0002).
"""

from __future__ import annotations

import os

import httpx

from .types import AgentMessage, ModelReply, ToolCall


def api_key() -> str | None:
    return os.environ.get("GEMINI_API_KEY")


def model_name() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-lite")


def base_url() -> str:
    """Đổi được để e2e trỏ sang Gemini giả — xem e2e/fakeGeminiServer.ts."""
    return os.environ.get("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com")


def system_prompt(context: dict) -> str:
    players = context.get("players") or []
    me = context.get("mePlayer")
    zero_sum = context.get("zeroSum")
    rounds_played = context.get("roundsPlayed", 0)
    confirm = context.get("confirmBeforeCommit")
    memory = context.get("memory") or []

    roster = "\n".join(f"- {p['name']}" for p in players)
    me_line = (
        f'Người đang cầm máy là {me} — "tôi/mình/tao" nghĩa là người này.'
        if me
        else ""
    )
    memory_block = (
        "Những điều bạn đã nhớ về nhóm này:\n"
        + "\n".join(f"- {m}" for m in memory)
        + "\n"
        if memory
        else ""
    )
    zero_sum_block = (
        """
QUAN TRỌNG — tổng điểm mỗi ván phải bằng 0:
- Nếu người nói ĐÃ cho biết cách chia thì tính ra rồi gọi record_round luôn.
  "Nam ăn 3, ba người kia mỗi người chung 1" → Nam +3, ba người còn lại mỗi người -1.
- Nếu CHƯA biết ai chung thì hỏi lại bằng chữ, đừng tự bịa.
- Cộng lại phải đúng 0 mới được gọi record_round."""
        if zero_sum
        else ""
    )
    confirm_block = (
        """
App tự hỏi xác nhận trước khi ghi — bạn KHÔNG cần hỏi "đúng không?" cho điều mình
đã hiểu rõ. Cứ gọi công cụ, app lo phần chốt."""
        if confirm
        else ""
    )

    return f"""Bạn là trợ lý ghi điểm bài, điều khiển hoàn toàn bằng giọng nói tiếng Việt.
Bạn LÀM ĐƯỢC mọi việc mà người dùng làm được bằng tay: ghi ván, sửa ván, xóa ván,
hoàn tác, làm lại, thêm/bớt người chơi, đổi thứ tự bảng, xem điểm, và ghi nhớ.

Người chơi (đã chơi {rounds_played} ván):
{roster}
{me_line}

{memory_block}Cách làm việc:
- Bạn được gọi nhiều lượt. Mỗi lượt: gọi MỘT công cụ, hoặc trả lời bằng chữ khi đã xong.
- Kết quả công cụ sẽ được đưa lại cho bạn ở lượt sau. Dùng nó để quyết bước tiếp.
- Cần biết điểm hiện tại trước khi quyết? Gọi get_scoreboard hoặc get_history trước.
- Khi đã làm xong việc, trả lời bằng MỘT CÂU NGẮN tiếng Việt, đọc lên nghe được.
- Đừng gọi công cụ chỉ để nói lại điều vừa làm — trả lời thẳng bằng chữ.

Hiểu tiếng Việt:
- "ăn", "thắng", "được" = điểm dương. "chung", "thua", "đền", "mất" = điểm âm.
- "ba người kia", "mấy người còn lại", "cả làng" = những người không được nhắc tên.
- Tên nghe được có thể sai chính tả do nhận dạng giọng nói; khớp gần đúng là được.
{zero_sum_block}
{confirm_block}
Chỉ trả lời bằng tiếng Việt có dấu."""


def to_gemini_contents(messages: list[AgentMessage]) -> list[dict]:
    """Hội thoại nội bộ → định dạng contents của Gemini.

    `thoughtSignature` phải được trả lại NGUYÊN VẸN kèm functionCall ở các lượt
    sau. Gemini 3.x từ chối cả request với 400 nếu thiếu — vòng ReAct gãy ngay ở
    bước thứ hai, đúng bước làm nên chữ "observe". Bản TypeScript đã trả giá một
    lần cho chỗ này (xem Evidence C-009).
    """
    contents: list[dict] = []
    for m in messages:
        if m.role == "user":
            contents.append({"role": "user", "parts": [{"text": m.text or ""}]})
        elif m.role == "model":
            if m.call:
                part: dict = {
                    "functionCall": {"name": m.call.name, "args": m.call.args or {}}
                }
                if m.call.thought_signature:
                    part["thoughtSignature"] = m.call.thought_signature
                contents.append({"role": "model", "parts": [part]})
            else:
                contents.append({"role": "model", "parts": [{"text": m.text or ""}]})
        elif m.role == "tool":
            contents.append(
                {
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": m.name,
                                "response": {"result": m.result},
                            }
                        }
                    ],
                }
            )
    return contents


async def call_gemini(
    messages: list[AgentMessage], tools: list[dict], context: dict
) -> ModelReply:
    """Một lượt gọi model: hội thoại vào, "gọi tool tiếp" hoặc "câu trả lời" ra.

    Lỗi được dịch thành câu người đọc được kèm cờ `retryable`, vì hai loại 429
    của Gemini có cách xử lý khác hẳn nhau: hết quota NGÀY thì mai mới dùng tiếp
    được (nói lại vô ích), còn quá giới hạn PHÚT thì chờ chút là xong.
    """
    key = api_key()
    if not key:
        return ModelReply(
            error="Thiếu GEMINI_API_KEY. Xem .env.example.", retryable=False
        )

    body = {
        "system_instruction": {"parts": [{"text": system_prompt(context)}]},
        "contents": to_gemini_contents(messages),
        "tools": [{"function_declarations": tools}],
        # AUTO chứ không ANY: agent phải được phép TRẢ LỜI BẰNG CHỮ khi đã xong,
        # nếu ép luôn gọi tool thì vòng lặp không bao giờ kết thúc.
        "tool_config": {"function_calling_config": {"mode": "AUTO"}},
        "generationConfig": {"temperature": 0},
    }

    url = f"{base_url()}/v1beta/models/{model_name()}:generateContent"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                url,
                json=body,
                headers={"content-type": "application/json", "x-goog-api-key": key},
            )

        if response.status_code != 200:
            detail = response.text
            print(f"Gemini {response.status_code}: {detail}", flush=True)
            if response.status_code == 429:
                per_day = "PerDay" in detail or "per_day" in detail
                if per_day:
                    return ModelReply(
                        error="Hết quota Gemini hôm nay. Mai dùng tiếp, hoặc nhập điểm bằng tay.",
                        retryable=False,
                    )
                return ModelReply(
                    error="Nói hơi nhanh, Gemini đang giới hạn theo phút. Chờ một chút rồi nói lại.",
                    retryable=True,
                )
            return ModelReply(
                error=f"Gemini trả lỗi {response.status_code}.", retryable=True
            )

        data = response.json()
        parts = (
            (data.get("candidates") or [{}])[0].get("content", {}).get("parts") or []
        )
        call_part = next((p for p in parts if p.get("functionCall")), None)
        if call_part:
            fn = call_part["functionCall"]
            return ModelReply(
                call=ToolCall(
                    name=fn.get("name", ""),
                    args=fn.get("args") or {},
                    thought_signature=call_part.get("thoughtSignature"),
                )
            )
        text_part = next((p for p in parts if p.get("text")), None)
        return ModelReply(text=text_part.get("text") if text_part else "")
    except Exception as error:
        print(f"gemini failed: {error}", flush=True)
        return ModelReply(error="Không gọi được Gemini.", retryable=True)
