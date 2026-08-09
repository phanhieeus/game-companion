"""Dịch từ server/domain/scoring.test.ts — cùng ca kiểm, cùng con số."""

from __future__ import annotations

from api.domain.models import (
    DEFAULT_SCORING_CONFIG,
    HouseBonus,
    Player,
    Round,
    ScoreEntry,
    ScoringConfig,
    Session,
)
from api.domain.scoring import (
    compute_scoreboard,
    deltas_from_ranking,
    describe_config,
    describe_house_rules,
    latest_recorded_round,
    next_sequence_no,
    players_missing_from,
    rank_labels,
    validate_player_count,
    validate_round_entries,
    validate_scoring_config,
)
from api.domain.models import DraftEntry

NAMES = ["Nam", "Hùng", "Lan", "Tú"]


def make_session(**overrides) -> Session:
    players = [
        Player(id=f"p{i}", sessionId="s1", name=name, seatNo=i + 1, status="active")
        for i, name in enumerate(NAMES)
    ]
    base = dict(
        id="s1",
        status="active",
        scoringConfig=DEFAULT_SCORING_CONFIG,
        players=players,
        rounds=[],
        createdAt="2026-01-01T00:00:00.000Z",
        confirmBeforeCommit=True,
    )
    base.update(overrides)
    return Session(**base)


def make_round(seq: int, deltas: dict[str, int], status="recorded") -> Round:
    return Round(
        id=f"r{seq}",
        sessionId="s1",
        sequenceNo=seq,
        status=status,
        createdAt="2026-01-01T00:00:00.000Z",
        source="manual",
        entries=[
            ScoreEntry(id=f"e{seq}{pid}", roundId=f"r{seq}", playerId=pid, delta=d)
            for pid, d in deltas.items()
        ],
    )


class TestComputeScoreboard:
    def test_phien_moi_moi_nguoi_0_diem(self):
        board = compute_scoreboard(make_session())
        assert [r.total for r in board.rows] == [0, 0, 0, 0]
        assert board.roundsPlayed == 0

    def test_cong_don_cac_van_da_ghi(self):
        session = make_session(
            rounds=[
                make_round(1, {"p0": 3, "p1": -1, "p2": -1, "p3": -1}),
                make_round(2, {"p1": 2, "p0": -2}),
            ]
        )
        board = compute_scoreboard(session)
        assert {r.name: r.total for r in board.rows} == {
            "Nam": 1,
            "Hùng": 1,
            "Lan": -1,
            "Tú": -1,
        }
        assert board.roundsPlayed == 2

    def test_bo_qua_van_da_huy(self):
        session = make_session(
            rounds=[
                make_round(1, {"p0": 3, "p1": -3}),
                make_round(2, {"p0": 5, "p1": -5}, status="voided"),
            ]
        )
        board = compute_scoreboard(session)
        assert {r.name: r.total for r in board.rows}["Nam"] == 3
        assert board.roundsPlayed == 1

    def test_dong_diem_dong_hang_va_nhay_qua(self):
        # 1, 2, 2, 4 — không phải 1, 2, 2, 3.
        session = make_session(
            rounds=[make_round(1, {"p0": 6, "p1": -2, "p2": -2, "p3": -2})]
        )
        board = compute_scoreboard(session)
        assert [r.rank for r in board.rows] == [1, 2, 2, 2]

    def test_hang_nhay_qua_khi_co_nguoi_dung_giua(self):
        session = make_session(
            rounds=[make_round(1, {"p0": 4, "p1": 0, "p2": -2, "p3": -2})]
        )
        board = compute_scoreboard(session)
        assert [(r.name, r.rank) for r in board.rows] == [
            ("Nam", 1),
            ("Hùng", 2),
            ("Lan", 3),
            ("Tú", 3),
        ]

    def test_bo_qua_nguoi_da_roi_phien(self):
        players = [
            Player(id=f"p{i}", sessionId="s1", name=n, seatNo=i + 1, status="active")
            for i, n in enumerate(NAMES)
        ]
        players[3].status = "removed"
        session = make_session(
            players=players, rounds=[make_round(1, {"p0": 3, "p3": -3})]
        )
        board = compute_scoreboard(session)
        assert [r.name for r in board.rows] == ["Nam", "Hùng", "Lan"]
        assert {r.name: r.total for r in board.rows}["Nam"] == 3

    def test_startingScore_khac_0(self):
        config = DEFAULT_SCORING_CONFIG.model_copy(update={"startingScore": 100})
        session = make_session(
            scoringConfig=config, rounds=[make_round(1, {"p0": 3, "p1": -3})]
        )
        board = compute_scoreboard(session)
        assert {r.name: r.total for r in board.rows} == {
            "Nam": 103,
            "Hùng": 97,
            "Lan": 100,
            "Tú": 100,
        }


class TestValidateRoundEntries:
    def test_van_can_thi_qua(self):
        session = make_session()
        entries = [
            DraftEntry(playerId="p0", delta=3),
            DraftEntry(playerId="p1", delta=-1),
            DraftEntry(playerId="p2", delta=-1),
            DraftEntry(playerId="p3", delta=-1),
        ]
        assert validate_round_entries(session, entries).ok

    def test_tong_khac_0_bi_chan(self):
        session = make_session()
        result = validate_round_entries(
            session,
            [DraftEntry(playerId="p0", delta=3), DraftEntry(playerId="p1", delta=-1)],
        )
        assert result.error.code == "SUM_DELTA_NOT_ZERO"
        assert "đang là 2" in result.error.message

    def test_van_rong(self):
        assert validate_round_entries(make_session(), []).error.code == "EMPTY_ROUND"

    def test_nguoi_khong_thuoc_phien(self):
        result = validate_round_entries(
            make_session(),
            [DraftEntry(playerId="ai-do", delta=0)],
        )
        assert result.error.code == "PLAYER_NOT_IN_SESSION"

    def test_mot_nguoi_hai_lan_trong_mot_van(self):
        result = validate_round_entries(
            make_session(),
            [DraftEntry(playerId="p0", delta=3), DraftEntry(playerId="p0", delta=-3)],
        )
        assert result.error.code == "DUPLICATE_PLAYER_IN_ROUND"

    def test_cam_diem_am_khi_cau_hinh_tat(self):
        config = DEFAULT_SCORING_CONFIG.model_copy(update={"allowNegative": False})
        session = make_session(scoringConfig=config)
        result = validate_round_entries(
            session,
            [DraftEntry(playerId="p0", delta=3), DraftEntry(playerId="p1", delta=-3)],
        )
        assert result.error.code == "NEGATIVE_NOT_ALLOWED"
        assert "Hùng" in result.error.message


class TestKhac:
    def test_so_nguoi_choi(self):
        assert validate_player_count(3).error.code == "TOO_FEW_PLAYERS"
        assert validate_player_count(6).error.code == "TOO_MANY_PLAYERS"
        assert validate_player_count(4).ok

    def test_next_sequence_no(self):
        assert next_sequence_no([]) == 1
        assert next_sequence_no([make_round(1, {}), make_round(7, {})]) == 8

    def test_latest_recorded_round_bo_qua_van_huy(self):
        rounds = [
            make_round(1, {"p0": 0}),
            make_round(2, {"p0": 0}, status="voided"),
        ]
        assert latest_recorded_round(rounds).sequenceNo == 1

    def test_describe_config(self):
        assert "tổng mỗi ván = 0" in describe_config(DEFAULT_SCORING_CONFIG)


# ── Luật nhà ───────────────────────────────────────────────────────────────


BANG_4 = [3, 1, -1, -3]
TU_QUY = HouseBonus(name="tứ quý", points=5, paidBy="each")


def with_rules(**config) -> Session:
    return make_session(scoringConfig=ScoringConfig(**config))


class TestBangHang:
    def test_bon_nguoi_ra_dung_bon_con_so(self):
        session = with_rules(rankPoints=BANG_4)
        entries = deltas_from_ranking(session, ["p0", "p1", "p2", "p3"], []).unwrap()

        assert {e.playerId: e.delta for e in entries} == {
            "p0": 3,
            "p1": 1,
            "p2": -1,
            "p3": -3,
        }
        assert sum(e.delta for e in entries) == 0

    def test_ten_nhan_hang_theo_so_nguoi(self):
        assert rank_labels(4) == ["nhất", "nhì", "ba", "bét"]
        assert rank_labels(5) == ["nhất", "nhì", "ba", "tư", "bét"]

    def test_thieu_mot_nguoi_thi_tu_choi_chu_khong_doan(self):
        """Xếp hạng ba người trong bàn bốn người: người thứ tư KHÔNG thành 0."""
        session = with_rules(rankPoints=BANG_4)
        result = deltas_from_ranking(session, ["p0", "p1", "p2"], [])

        assert result.ok is False
        assert result.error.code == "MISSING_PLAYERS"
        assert "Tú" in result.error.message

    def test_mot_nguoi_khong_the_vua_nhat_vua_nhi(self):
        session = with_rules(rankPoints=BANG_4)
        result = deltas_from_ranking(session, ["p0", "p0", "p1", "p2"], [])
        assert result.error.code == "DUPLICATE_PLAYER_IN_ROUND"

    def test_chua_dat_bang_hang_thi_noi_thang(self):
        result = deltas_from_ranking(make_session(), ["p0", "p1", "p2", "p3"], [])
        assert result.error.code == "NO_RANK_POINTS"


class TestBangHangLechSoNguoi:
    """Thêm/bớt người giữa phiên thì bảng hạng cũ hết dùng được."""

    def test_bang_bon_nguoi_khong_dung_cho_ban_nam_nguoi(self):
        session = with_rules(rankPoints=BANG_4)
        session.players.append(
            Player(id="p4", sessionId="s1", name="Mai", seatNo=5, status="active")
        )

        result = deltas_from_ranking(
            session, ["p0", "p1", "p2", "p3", "p4"], []
        )
        assert result.ok is False
        assert result.error.code == "RANK_POINTS_MISMATCH"
        assert "4" in result.error.message and "5" in result.error.message

    def test_bot_nguoi_cung_lam_bang_hang_het_hieu_luc(self):
        session = with_rules(rankPoints=BANG_4)
        session.players[3].status = "removed"

        result = deltas_from_ranking(session, ["p0", "p1", "p2"], [])
        assert result.error.code == "RANK_POINTS_MISMATCH"

    def test_dat_bang_lech_so_nguoi_bi_chan_ngay_luc_dat(self):
        session = make_session()
        result = validate_scoring_config(session, ScoringConfig(rankPoints=[3, -3]))
        assert result.error.code == "RANK_POINTS_MISMATCH"


class TestZeroSumVanLaCongCuoi:
    """Có cấu hình rồi không có nghĩa là được nới cổng đó."""

    def test_bang_hang_khong_can_bi_chan_luc_dat(self):
        session = make_session()
        result = validate_scoring_config(session, ScoringConfig(rankPoints=[3, 1, -1, -2]))
        assert result.ok is False
        assert result.error.code == "SUM_DELTA_NOT_ZERO"

    def test_bang_hang_khong_can_van_bi_chan_luc_ghi(self):
        """Cấu hình lệch lọt vào được (dữ liệu cũ) thì lưới cuối vẫn bắt."""
        session = with_rules(rankPoints=[3, 1, -1, -2])
        entries = deltas_from_ranking(session, ["p0", "p1", "p2", "p3"], []).unwrap()

        assert sum(e.delta for e in entries) == 1
        assert validate_round_entries(session, entries).error.code == "SUM_DELTA_NOT_ZERO"

    def test_bang_bon_nguoi_khong_can_voi_nam_nguoi(self):
        """[3,1,-1,-3] cân với 4 người; thêm người thứ 5 là hết cân.

        Tổng vẫn 0 nếu chỉ cộng bốn số, nhưng bàn năm người thì người thứ năm
        không có mức nào — và app phải nói ra chứ không co bảng lại.
        """
        session = with_rules(rankPoints=BANG_4)
        session.players.append(
            Player(id="p4", sessionId="s1", name="Mai", seatNo=5, status="active")
        )
        assert validate_scoring_config(session, session.scoringConfig).ok is False


class TestThuong:
    def test_moi_nguoi_chung_du(self):
        session = with_rules(rankPoints=None, bonuses=[TU_QUY])
        entries = deltas_from_ranking(session, [], [("tứ quý", "p0")]).unwrap()

        assert {e.playerId: e.delta for e in entries} == {
            "p0": 15,
            "p1": -5,
            "p2": -5,
            "p3": -5,
        }
        assert sum(e.delta for e in entries) == 0

    def test_chia_deu(self):
        session = with_rules(bonuses=[HouseBonus(name="ù", points=6, paidBy="split")])
        entries = deltas_from_ranking(session, [], [("ù", "p1")]).unwrap()

        assert {e.playerId: e.delta for e in entries} == {
            "p0": -2,
            "p1": 6,
            "p2": -2,
            "p3": -2,
        }

    def test_chia_deu_khong_ra_so_nguyen_thi_tu_choi(self):
        """Làm tròn hộ là tự bịa ra luật nhà — thà từ chối."""
        session = with_rules(bonuses=[HouseBonus(name="ù", points=5, paidBy="split")])
        assert deltas_from_ranking(session, [], [("ù", "p1")]).error.code == "BONUS_INVALID"

    def test_thuong_khong_co_trong_luat_thi_khong_bia(self):
        session = with_rules(bonuses=[TU_QUY])
        result = deltas_from_ranking(session, [], [("ngũ linh", "p0")])
        assert result.error.code == "BONUS_NOT_FOUND"
        assert "tứ quý" in result.error.message

    def test_thuong_cong_don_voi_diem_hang_van_ve_0(self):
        session = with_rules(rankPoints=BANG_4, bonuses=[TU_QUY])
        entries = deltas_from_ranking(
            session, ["p0", "p1", "p2", "p3"], [("tứ quý", "p0")]
        ).unwrap()

        assert {e.playerId: e.delta for e in entries} == {
            "p0": 18,
            "p1": -4,
            "p2": -6,
            "p3": -8,
        }
        assert sum(e.delta for e in entries) == 0
        assert validate_round_entries(session, entries).ok


class TestKhongAiBiBoQuen:
    def test_nguoi_khong_duoc_nhac_ten_bi_diem_danh(self):
        session = make_session()
        missing = players_missing_from(
            session, [DraftEntry(playerId="p0", delta=3), DraftEntry(playerId="p1", delta=-3)]
        )
        assert missing == ["Lan", "Tú"]

    def test_du_nguoi_thi_khong_thieu_ai(self):
        session = make_session()
        entries = [DraftEntry(playerId=f"p{i}", delta=0) for i in range(4)]
        assert players_missing_from(session, entries) == []

    def test_nguoi_da_roi_phien_khong_bi_doi_diem(self):
        session = make_session()
        session.players[3].status = "removed"
        entries = [DraftEntry(playerId=f"p{i}", delta=0) for i in range(3)]
        assert players_missing_from(session, entries) == []

    def test_van_suy_ra_tu_bang_hang_luon_co_du_moi_nguoi(self):
        """Kể cả người 0 điểm — nhờ vậy đường này không bao giờ bỏ sót ai."""
        session = with_rules(bonuses=[TU_QUY])
        entries = deltas_from_ranking(session, [], [("tứ quý", "p0")]).unwrap()
        assert players_missing_from(session, entries) == []


class TestKeLuatNhaBangLoi:
    def test_ke_ca_bang_hang_lan_thuong(self):
        session = with_rules(rankPoints=BANG_4, bonuses=[TU_QUY])
        text = describe_house_rules(session)
        assert "nhất +3" in text and "bét -3" in text
        assert "tứ quý" in text and "mỗi người còn lại chung đủ" in text

    def test_noi_ro_khi_bang_hang_lech_so_nguoi(self):
        session = with_rules(rankPoints=BANG_4)
        session.players[3].status = "removed"
        assert "bàn có 3" in describe_house_rules(session)
