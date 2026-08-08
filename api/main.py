"""Backend của app ghi điểm (ADR 13, 16).

Server sở hữu miền nghiệp vụ: dữ liệu phiên, tool layer, và cả vòng ReAct của
agent. Frontend chỉ trình bày và thu thao tác. API key không bao giờ xuống trình
duyệt (decision 0002).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
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
DATABASE_URL = os.environ.get("DATABASE_URL")

# Có CSDL thì dùng, không thì ghi ra đĩa (ADR 14 sửa ở C-017).
#
# Giữ được cả hai vì `SessionRepository` là Protocol từ decision 0001. Nhờ vậy
# `npm run dev` chạy được khi không có Postgres, còn Render — nơi đĩa là tạm
# thời — thì dữ liệu không bốc hơi sau mỗi lần redeploy.
if DATABASE_URL:
    from .agent.pgmemory import PgFactStore
    from .repository.postgres import PgSessionRepository

    from .repository.traces import PgTraceStore

    repo = PgSessionRepository(DATABASE_URL)
    fact_store = PgFactStore(DATABASE_URL)
    trace_store = PgTraceStore(DATABASE_URL)
    print("[api] kho: Postgres", file=sys.stderr, flush=True)
else:
    from .repository.traces import FileTraceStore

    repo = FileSessionRepository(DATA_DIR / "sessions.json")
    fact_store = FileFactStore(DATA_DIR / "memory.json")
    trace_store = FileTraceStore(DATA_DIR / "traces.json")
    print(f"[api] kho: file trong {DATA_DIR}", file=sys.stderr, flush=True)

tools = create_tools(repo)

app = FastAPI(title="Ghi điểm", version="1.0.0")

agent_router = build_agent_router(tools, repo, fact_store, trace_store)
app.include_router(build_session_router(tools, repo), prefix="/api/sessions")
app.include_router(agent_router, prefix="/api/sessions")


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
        # Dọn cả hạn mức: mỗi test bắt đầu từ con số không, nếu không thì test
        # chạy sau bị test chạy trước ăn mất phần.
        agent_router.limiter.reset()  # type: ignore[attr-defined]
        return {"ok": True}

    print("[api] E2E_RESET đang BẬT — có route xoá sạch dữ liệu.", file=sys.stderr, flush=True)


# ── Phục vụ web đã build (C-018) ────────────────────────────────────────────
#
# Local vẫn hai tiến trình vì vite có hot reload; production một tiến trình cho
# gọn và để cùng origin — khỏi CORS, khỏi cấu hình proxy.
DIST = Path(__file__).resolve().parent.parent / "dist"

if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """Mọi đường dẫn không phải /api/* đều trả index.html.

        Route này khai SAU tất cả route API nên không nuốt mất chúng. Đường dẫn
        sâu phải trả index.html chứ không phải 404: tải lại trang ở bất kỳ đâu
        cũng phải mở được app.
        """
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")


@app.exception_handler(Exception)
async def unhandled(_request, error: Exception) -> JSONResponse:
    """Lỗi ngoài dự tính → 500 + `retryable: true`.

    Lỗi luật chơi đã ra 400 ở tầng route, nên tới đây chỉ còn thứ thật sự hỏng —
    và thứ đó thì thử lại có khi được.
    """
    print(f"unhandled: {error}", file=sys.stderr, flush=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": {"code": "INTERNAL", "message": "Máy chủ trục trặc."},
            "retryable": True,
        },
    )
