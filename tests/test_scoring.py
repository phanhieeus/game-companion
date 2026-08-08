"""Dịch từ server/domain/scoring.test.ts — cùng ca kiểm, cùng con số."""

from __future__ import annotations

from api.domain.models import (
    DEFAULT_SCORING_CONFIG,
    Player,
    Round,
    ScoreEntry,
    Session,
)
from api.domain.scoring import (
    compute_scoreboard,
    describe_config,
    latest_recorded_round,
    next_sequence_no,
    validate_player_count,
    validate_round_entries,
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
