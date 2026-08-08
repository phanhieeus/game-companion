"""Backend của app ghi điểm (ADR 13, 16).

Server sở hữu miền nghiệp vụ: dữ liệu phiên, tool layer, và cả vòng ReAct của
agent. Frontend chỉ trình bày và thu thao tác. API key không bao giờ xuống trình
duyệt (decision 0002).
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv()

from .agent.gemini import api_key, model_name  # noqa: E402
from .domain.models import MAX_PLAYERS, MIN_PLAYERS  # noqa: E402
from .agent.memory import FileFactStore  # noqa: E402
from .repository.file import FileSessionRepository  # noqa: E402
from .routes.agent import build_agent_router  # noqa: E402
from .routes.sessions import build_session_router  # noqa: E402
from .tools import create_tools  # noqa: E402

DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))

repo = FileSessionRepository(DATA_DIR / "sessions.json")
tools = create_tools(repo)
fact_store = FileFactStore(DATA_DIR / "memory.json")

app = FastAPI(title="Ghi điểm", version="1.0.0")

app.include_router(build_session_router(tools, repo), prefix="/api/sessions")
app.include_router(build_agent_router(tools, repo, fact_store), prefix="/api/sessions")


class Health(BaseModel):
    ok: bool
    model: str
    hasKey: bool
    #: Giới hạn số người chơi — server là nơi ÁP, client chỉ hiện form theo.
    #: Trả về đây để client khỏi khai lại một con số đã có chủ.
    minPlayers: int
    maxPlayers: int


@app.get("/api/health", response_model=Health)
def health() -> dict:
    return {
        "ok": True,
        "model": model_name(),
        "hasKey": bool(api_key()),
        "minPlayers": MIN_PLAYERS,
        "maxPlayers": MAX_PLAYERS,
    }


if os.environ.get("E2E_RESET") == "1":
    # Xoá sạch dữ liệu — CHỈ tồn tại khi bật `E2E_RESET`.
    #
    # Mỗi test e2e phải bắt đầu từ con số không, mà dữ liệu nằm ở server nên xoá
    # localStorage không còn tác dụng gì. Đặt sau cờ môi trường để route này đơn
    # giản là KHÔNG TỒN TẠI khi chạy thật — không phải "có nhưng chặn".
    @app.post("/api/test/reset")
    def reset() -> dict:
        for session in repo.list():
            repo.delete(session.id)
        return {"ok": True}

    print("[api] E2E_RESET đang BẬT — có route xoá sạch dữ liệu.", flush=True)


@app.exception_handler(Exception)
async def unhandled(_request, error: Exception) -> JSONResponse:
    """Lỗi ngoài dự tính → 500 + `retryable: true`.

    Lỗi luật chơi đã ra 400 ở tầng route, nên tới đây chỉ còn thứ thật sự hỏng —
    và thứ đó thì thử lại có khi được.
    """
    print(f"unhandled: {error}", flush=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": {"code": "INTERNAL", "message": "Máy chủ trục trặc."},
            "retryable": True,
        },
    )
