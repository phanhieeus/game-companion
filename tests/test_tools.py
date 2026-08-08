"""Dịch từ server/tools/index.test.ts — hợp đồng tool layer (decision 0001)."""

from __future__ import annotations

import pytest

from api.domain.models import DraftEntry
from api.repository.memory import MemorySessionRepository
from api.tools import create_tools

from conftest import PLAYERS, Harness


class TestCreateSession:
    def test_tu_choi_duoi_4_nguoi(self):
        tools = create_tools(MemorySessionRepository())
        r = tools.create_session(players=[{"name": "A"}, {"name": "B"}])
        assert r.error.code == "TOO_FEW_PLAYERS"

    def test_tu_choi_qua_5_nguoi(self):
        tools = create_tools(MemorySessionRepository())
        r = tools.create_session(
            players=[*PLAYERS, {"name": "Minh"}, {"name": "Sơn"}]
        )
        assert r.error.code == "TOO_MANY_PLAYERS"

    def test_gan_ghe_theo_thu_tu(self, h: Harness):
        assert [p.seatNo for p in h.session.players] == [1, 2, 3, 4]

    def test_nhan_dien_nguoi_cam_may(self):
        tools = create_tools(MemorySessionRepository())
        r = tools.create_session(players=PLAYERS, me_player_name="hùng")
        session_id = r.unwrap()["session_id"]
        session = tools.repo.get(session_id)
        me = next(p for p in session.players if p.id == session.mePlayerId)
        assert me.name == "Hùng"

    def test_mac_dinh_bat_xac_nhan(self, h: Harness):
        assert h.session.confirmBeforeCommit is True


class TestRecordRound:
    def test_ghi_van_can(self, h: Harness):
        r = h.tools.record_round(h.session_id, h.entries(3, -1, -1, -1))
        assert r.ok
        assert h.totals() == {"Nam": 3, "Hùng": -1, "Lan": -1, "Tú": -1}

    def test_chan_van_khong_can(self, h: Harness):
        r = h.tools.record_round(h.session_id, h.entries(3, -1))
        assert r.error.code == "SUM_DELTA_NOT_ZERO"
        assert h.session.rounds == []

    def test_so_thu_tu_tang_dan(self, h: Harness):
        for _ in range(3):
            h.tools.record_round(h.session_id, h.entries(1, -1))
        assert [r.sequenceNo for r in h.session.rounds] == [1, 2, 3]

    def test_idempotency_cung_request_id_chi_mot_van(self, h: Harness):
        first = h.tools.record_round(
            h.session_id, h.entries(3, -3), client_request_id="abc"
        )
        second = h.tools.record_round(
            h.session_id, h.entries(3, -3), client_request_id="abc"
        )
        assert first.unwrap()["round_id"] == second.unwrap()["round_id"]
        assert len(h.session.rounds) == 1

    def test_ghi_van_sinh_muc_nhat_ky_created(self, h: Harness):
        r = h.tools.record_round(h.session_id, h.entries(3, -3))
        events = h.tools.get_round_events(
            h.session_id, r.unwrap()["round_id"]
        ).unwrap()["events"]
        assert [e.kind for e in events] == ["created"]
        assert events[0].after is not None

    def test_khong_ghi_len_phien_da_ket_thuc(self, h: Harness):
        h.tools.end_session(h.session_id)
        r = h.tools.record_round(h.session_id, h.entries(1, -1))
        assert r.error.code == "SESSION_ENDED"

    def test_phien_khong_ton_tai(self, h: Harness):
        r = h.tools.record_round("khong-co", h.entries(1, -1))
        assert r.error.code == "SESSION_NOT_FOUND"


class TestUpdateRound:
    def test_sua_van_thi_tinh_lai_bang(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.update_round(h.session_id, rid, h.entries(5, -5))
        assert h.totals()["Nam"] == 5

    def test_sua_van_ghi_vao_nhat_ky_kem_truoc_sau(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.update_round(h.session_id, rid, h.entries(5, -5))
        events = h.tools.get_round_events(h.session_id, rid).unwrap()["events"]
        assert [e.kind for e in events] == ["created", "updated"]
        assert {e.delta for e in events[1].before} == {3, -3}
        assert {e.delta for e in events[1].after} == {5, -5}

    def test_sua_rong_khong_ghi_nhat_ky(self, h: Harness):
        """ADR 9 — mở ô ra rồi lưu y nguyên thì không phải một thay đổi."""
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.update_round(h.session_id, rid, h.entries(3, -3))
        events = h.tools.get_round_events(h.session_id, rid).unwrap()["events"]
        assert [e.kind for e in events] == ["created"]

    def test_sua_rong_khong_xoa_nhanh_lam_lai(self, h: Harness):
        """ADR 9 — đẩy con trỏ là xoá nhánh làm lại một cách vô cớ.

        Hoàn tác ván 2, rồi mở ván 1 (vẫn đang hiệu lực) ra lưu y nguyên. Đó
        không phải thao tác mới nên nhánh làm lại phải còn.
        """
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.record_round(h.session_id, h.entries(5, -5))
        h.tools.undo_last(h.session_id)
        assert h.tools.get_undo_state(h.session_id).unwrap()["redo"] is not None

        h.tools.update_round(h.session_id, rid, h.entries(3, -3))
        assert h.tools.get_undo_state(h.session_id).unwrap()["redo"] is not None

    def test_sua_van_da_huy_la_khoi_phuc_du_diem_y_het(self, h: Harness):
        """Ván đang bị xóa thì lưu lại là KHÔI PHỤC — không phải sửa rỗng."""
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.undo_round(h.session_id, rid)
        h.tools.update_round(h.session_id, rid, h.entries(3, -3))

        events = h.tools.get_round_events(h.session_id, rid).unwrap()["events"]
        assert [e.kind for e in events] == ["created", "voided", "restored"]

    def test_sua_van_da_huy_thi_khoi_phuc(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.undo_round(h.session_id, rid)
        h.tools.update_round(h.session_id, rid, h.entries(4, -4))

        events = h.tools.get_round_events(h.session_id, rid).unwrap()["events"]
        assert [e.kind for e in events] == ["created", "voided", "restored"]
        assert h.totals()["Nam"] == 4

    def test_van_khong_ton_tai(self, h: Harness):
        r = h.tools.update_round(h.session_id, "khong-co", h.entries(1, -1))
        assert r.error.code == "ROUND_NOT_FOUND"

    def test_sua_thanh_van_khong_can_bi_chan(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        r = h.tools.update_round(h.session_id, rid, h.entries(3, -1))
        assert r.error.code == "SUM_DELTA_NOT_ZERO"


class TestUndoRound:
    def test_huy_van_gan_nhat_khi_khong_chi_dinh(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(3, -3))
        h.tools.record_round(h.session_id, h.entries(5, -5))
        h.tools.undo_round(h.session_id)
        assert h.totals()["Nam"] == 3

    def test_huy_dung_van_duoc_chi_dinh(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.record_round(h.session_id, h.entries(5, -5))
        h.tools.undo_round(h.session_id, rid)
        assert h.totals()["Nam"] == 5

    def test_khong_con_van_de_huy(self, h: Harness):
        assert h.tools.undo_round(h.session_id).error.code == "NO_ROUND_TO_UNDO"

    def test_huy_van_da_huy(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.undo_round(h.session_id, rid)
        r = h.tools.undo_round(h.session_id, rid)
        assert r.error.code == "NO_ROUND_TO_UNDO"

    def test_huy_van_ghi_vao_nhat_ky(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.undo_round(h.session_id, rid)
        events = h.tools.get_round_events(h.session_id, rid).unwrap()["events"]
        assert [e.kind for e in events] == ["created", "voided"]


class TestUndoRedoToanPhien:
    """C-007 — con trỏ undo đi trên chuỗi thao tác THẬT."""

    def test_hoan_tac_them_van(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(3, -3))
        h.tools.undo_last(h.session_id)
        assert h.totals()["Nam"] == 0

    def test_hoan_tac_roi_lam_lai_ve_dung_trang_thai_cu(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(3, -3))
        h.tools.undo_last(h.session_id)
        h.tools.redo_last(h.session_id)
        assert h.totals()["Nam"] == 3

    def test_hoan_tac_sua_van(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(3, -3)).unwrap()["round_id"]
        h.tools.update_round(h.session_id, rid, h.entries(9, -9))
        h.tools.undo_last(h.session_id)
        assert h.totals()["Nam"] == 3

    def test_lui_nhieu_buoc_roi_tien_lai_nhieu_buoc(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(1, -1))
        h.tools.record_round(h.session_id, h.entries(2, -2))
        h.tools.record_round(h.session_id, h.entries(4, -4))
        assert h.totals()["Nam"] == 7

        for _ in range(3):
            h.tools.undo_last(h.session_id)
        assert h.totals()["Nam"] == 0

        for _ in range(3):
            h.tools.redo_last(h.session_id)
        assert h.totals()["Nam"] == 7

    def test_hoan_tac_khong_tu_hoan_tac_chinh_no(self, h: Harness):
        """Bấm Hoàn tác hai lần phải lùi hai thao tác, không phải thành redo."""
        h.tools.record_round(h.session_id, h.entries(1, -1))
        h.tools.record_round(h.session_id, h.entries(2, -2))

        h.tools.undo_last(h.session_id)
        h.tools.undo_last(h.session_id)
        assert h.totals()["Nam"] == 0

    def test_thao_tac_moi_sau_khi_hoan_tac_thi_bo_nhanh_lam_lai(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(1, -1))
        h.tools.undo_last(h.session_id)
        h.tools.record_round(h.session_id, h.entries(5, -5))

        assert h.tools.get_undo_state(h.session_id).unwrap()["redo"] is None

    def test_khong_con_gi_de_hoan_tac(self, h: Harness):
        assert h.tools.undo_last(h.session_id).error.code == "NO_ROUND_TO_UNDO"

    def test_khong_con_gi_de_lam_lai(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(1, -1))
        assert h.tools.redo_last(h.session_id).error.code == "NO_ROUND_TO_UNDO"

    def test_nhan_nut_mo_ta_dung_thao_tac(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(1, -1))
        state = h.tools.get_undo_state(h.session_id).unwrap()
        assert state["undo"] == "Hoàn tác thêm ván 1"
        assert state["redo"] is None

        assert h.tools.undo_last(h.session_id).unwrap()["label"] == "Đã hoàn tác thêm ván 1"

    def test_hoan_tac_van_ghi_them_vao_nhat_ky_khong_mat_audit(self, h: Harness):
        rid = h.tools.record_round(h.session_id, h.entries(1, -1)).unwrap()["round_id"]
        h.tools.undo_last(h.session_id)
        events = h.tools.get_round_events(h.session_id, rid).unwrap()["events"]
        assert [e.kind for e in events] == ["created", "voided"]
        assert events[1].isUndo is True


class TestNguoiChoi:
    def test_them_nguoi(self, h: Harness):
        assert h.tools.add_player(h.session_id, "Minh").ok
        assert len(h.session.players) == 5

    def test_khong_qua_5_nguoi(self, h: Harness):
        h.tools.add_player(h.session_id, "Minh")
        assert h.tools.add_player(h.session_id, "Sơn").error.code == "TOO_MANY_PLAYERS"

    def test_bo_nguoi_thi_danh_dau_khong_xoa(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(3, -3))
        h.tools.remove_player(h.session_id, h.ids[3])

        # Ván cũ vẫn nguyên; chỉ bảng điểm bớt một dòng.
        assert len(h.session.rounds[0].entries) == 2
        assert "Tú" not in h.totals()

    def test_bo_nguoi_khong_ton_tai(self, h: Harness):
        r = h.tools.remove_player(h.session_id, "khong-co")
        assert r.error.code == "PLAYER_NOT_IN_SESSION"


class TestDocVaCaiDat:
    def test_get_player_score(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(3, -3))
        row = h.tools.get_player_score(h.session_id, h.ids[0]).unwrap()
        assert row == {"name": "Nam", "total": 3, "rank": 1}

    def test_get_history_moi_nhat_truoc_va_cat_theo_limit(self, h: Harness):
        for d in (1, 2, 3):
            h.tools.record_round(h.session_id, h.entries(d, -d))
        rounds = h.tools.get_history(h.session_id, limit=2).unwrap()["rounds"]
        assert [r.sequenceNo for r in rounds] == [3, 2]

    def test_tat_xac_nhan_truoc_khi_ghi(self, h: Harness):
        h.tools.set_confirm_before_commit(h.session_id, False)
        assert h.session.confirmBeforeCommit is False

    def test_ket_thuc_phien(self, h: Harness):
        h.tools.end_session(h.session_id)
        assert h.session.status == "ended"
        assert h.session.endedAt is not None

    def test_doi_cau_hinh_khong_hoi_to_van_cu(self, h: Harness):
        h.tools.record_round(h.session_id, h.entries(3, -3))
        h.tools.update_scoring_config(h.session_id, {"startingScore": 100})
        # Ván cũ giữ nguyên; điểm bắt đầu mới áp cho phép tính hiện tại.
        assert h.totals()["Nam"] == 103
