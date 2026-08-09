/**
 * SINH TỰ ĐỘNG — ĐỪNG SỬA TAY.
 *
 * Nguồn: OpenAPI của FastAPI (api/routes/schemas.py). Chạy lại bằng:
 *   npm run gen:types
 *
 * File này được commit để đọc diff là thấy hợp đồng đổi chỗ nào (ADR 17).
 */

export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create */
        post: operations["create_api_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create */
        post: operations["create_api_sessions__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get One */
        get: operations["get_one_api_sessions__session_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/agent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Speak */
        post: operations["speak_api_sessions__session_id__agent_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/agent/confirm": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirm
         * @description KHÔNG tính vào hạn mức — cố ý.
         *
         *     Chốt là NỬA SAU của một lượt người dùng đã trả giá ở `/agent`. Chặn nó
         *     thì người dùng kẹt giữa chừng: đề xuất treo trên màn hình mà bấm gì cũng
         *     không được, và cách thoát duy nhất là tải lại trang.
         *
         *     Không sợ bị lạm dụng: chốt cần một lời gọi đang chờ, mà lời gọi đó chỉ
         *     sinh ra từ `/agent` — nơi đã có hạn mức. Không có gì chờ thì trả 409
         *     ngay, không tốn lượt Gemini nào.
         */
        post: operations["confirm_api_sessions__session_id__agent_confirm_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/end": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** End */
        post: operations["end_api_sessions__session_id__end_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/players": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add Player */
        post: operations["add_player_api_sessions__session_id__players_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/players/{player_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove Player */
        delete: operations["remove_player_api_sessions__session_id__players__player_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/redo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redo */
        post: operations["redo_api_sessions__session_id__redo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/rounds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Record */
        post: operations["record_api_sessions__session_id__rounds_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/rounds/{round_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete */
        delete: operations["delete_api_sessions__session_id__rounds__round_id__delete"];
        options?: never;
        head?: never;
        /** Update */
        patch: operations["update_api_sessions__session_id__rounds__round_id__patch"];
        trace?: never;
    };
    "/api/sessions/{session_id}/rounds/{round_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Events */
        get: operations["events_api_sessions__session_id__rounds__round_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Settings */
        patch: operations["settings_api_sessions__session_id__settings_patch"];
        trace?: never;
    };
    "/api/sessions/{session_id}/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Undo */
        post: operations["undo_api_sessions__session_id__undo_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/undo-state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Undo State
         * @description Nút hoàn tác/làm lại phải biết còn gì để làm không, trước khi bấm.
         */
        get: operations["undo_state_api_sessions__session_id__undo_state_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Active
         * @description Phiên đang chơi CỦA THIẾT BỊ NÀY (ADR 15 sửa ở C-019).
         *
         *     Thoát giữa chừng rồi mở lại là về đúng ván bài của mình; máy người khác
         *     không bao giờ thấy phiên này.
         */
        get: operations["active_api_sessions_active_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * ActiveView
         * @description `null` khi chưa có phiên nào đang chơi.
         */
        ActiveView: {
            scoreboard: components["schemas"]["Scoreboard"] | null;
            session: components["schemas"]["Session"] | null;
        };
        /** AgentReply */
        AgentReply: {
            /** Outcome */
            outcome: components["schemas"]["FinalOutcome"] | components["schemas"]["ConfirmOutcome"] | components["schemas"]["ClarifyOutcome"] | components["schemas"]["ErrorOutcome"];
            scoreboard: components["schemas"]["Scoreboard"];
            session: components["schemas"]["Session"];
            /** Steps */
            steps: number;
            uiIntents: components["schemas"]["UiIntents"];
        };
        /** ClarifyOutcome */
        ClarifyOutcome: {
            /** Question */
            question: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "clarify";
        };
        /**
         * ConfirmOutcome
         * @description Client CHỈ nhận được chừng này — không có tên tool, không có `call`.
         *
         *     Lời gọi đang chờ nằm ở server (ADR 13) nên client không có đường nào tự chạy
         *     tool; nó chỉ trả lời có/không.
         */
        ConfirmOutcome: {
            /** Prompt */
            prompt: string;
            /** Rows */
            rows: components["schemas"]["ProposalRow"][] | null;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "confirm";
        };
        /**
         * ErrorBody
         * @description Lỗi có mã, để UI phân biệt "nói sai luật" với "mất mạng".
         */
        ErrorBody: {
            error: components["schemas"]["ErrorDetail"];
            /** Retryable */
            retryable: boolean;
        };
        /** ErrorDetail */
        ErrorDetail: {
            /** Code */
            code: string;
            /** Message */
            message: string;
        };
        /** ErrorOutcome */
        ErrorOutcome: {
            /** Message */
            message: string;
            /** Retryable */
            retryable: boolean;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "error";
        };
        /** EventsView */
        EventsView: {
            /** Events */
            events: components["schemas"]["RoundEvent"][];
        };
        /** FinalOutcome */
        FinalOutcome: {
            /** Text */
            text: string;
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "final";
        };
        /** Health */
        Health: {
            /** Haskey */
            hasKey: boolean;
            /** Maxplayers */
            maxPlayers: number;
            /** Minplayers */
            minPlayers: number;
            /** Model */
            model: string;
            /** Ok */
            ok: boolean;
        };
        /**
         * HouseBonus
         * @description Một khoản thưởng theo luật nhà: "tứ quý" 5 điểm.
         *
         *     `paidBy` phân biệt hai cách chia mà bàn bài nào cũng có, và chúng cho ra
         *     con số KHÁC HẲN nhau nên không được đoán:
         *
         *     - `each`  — mỗi người còn lại chung ĐỦ 5. Bàn 4 người: người ăn +15.
         *     - `split` — 5 điểm ấy ba người kia chia nhau. Người ăn +5, mỗi người −5/3…
         *       nên `points` phải chia hết cho số người còn lại, không thì từ chối.
         */
        HouseBonus: {
            /** Name */
            name: string;
            /**
             * Paidby
             * @default each
             * @enum {string}
             */
            paidBy: "each" | "split";
            /** Points */
            points: number;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** LabeledView */
        LabeledView: {
            /** Label */
            label: string;
            scoreboard: components["schemas"]["Scoreboard"];
            session: components["schemas"]["Session"];
        };
        /** Player */
        Player: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Seatno */
            seatNo: number | null;
            /** Sessionid */
            sessionId: string;
            /**
             * Status
             * @default active
             * @enum {string}
             */
            status: "active" | "removed";
        };
        /**
         * ProposalRow
         * @description Một dòng trong thẻ đề xuất: ai, bao nhiêu điểm.
         */
        ProposalRow: {
            /** Delta */
            delta: number;
            /** Name */
            name: string;
            /** Playerid */
            playerId: string;
        };
        /** Round */
        Round: {
            /** Clientrequestid */
            clientRequestId: string | null;
            /** Createdat */
            createdAt: string;
            /** Entries */
            entries: components["schemas"]["ScoreEntry"][];
            /** Events */
            events: components["schemas"]["RoundEvent"][] | null;
            /** Id */
            id: string;
            /** Sequenceno */
            sequenceNo: number;
            /** Sessionid */
            sessionId: string;
            /**
             * Source
             * @default manual
             * @enum {string}
             */
            source: "voice" | "manual";
            /**
             * Status
             * @default recorded
             * @enum {string}
             */
            status: "recorded" | "voided";
        };
        /**
         * RoundEvent
         * @description Nhật ký thay đổi của một ván — bất biến, chỉ thêm không sửa (ADR 8).
         *
         *     Cho sửa trực tiếp từng ô mà không truy được ai sửa gì lúc nào thì mất luôn
         *     khả năng giải quyết tranh cãi — đúng lý do bảng theo ván tồn tại. Log là
         *     điều kiện để mở tính năng sửa, không phải tính năng phụ.
         */
        RoundEvent: {
            /** After */
            after: components["schemas"]["RoundEventEntry"][] | null;
            /** At */
            at: string;
            /** Before */
            before: components["schemas"]["RoundEventEntry"][] | null;
            /** Id */
            id: string;
            /** Isredo */
            isRedo: boolean | null;
            /** Isundo */
            isUndo: boolean | null;
            /**
             * Kind
             * @enum {string}
             */
            kind: "created" | "updated" | "voided" | "restored";
            /**
             * Source
             * @enum {string}
             */
            source: "voice" | "manual";
        };
        /** RoundEventEntry */
        RoundEventEntry: {
            /** Delta */
            delta: number;
            /** Playerid */
            playerId: string;
        };
        /** Scoreboard */
        Scoreboard: {
            /**
             * Roundsplayed
             * @default 0
             */
            roundsPlayed: number;
            /** Rows */
            rows: components["schemas"]["ScoreboardRow"][];
        };
        /** ScoreboardRow */
        ScoreboardRow: {
            /** Name */
            name: string;
            /** Playerid */
            playerId: string;
            /** Rank */
            rank: number;
            /** Total */
            total: number;
        };
        /** ScoreEntry */
        ScoreEntry: {
            /** Delta */
            delta: number;
            /** Id */
            id: string;
            /** Playerid */
            playerId: string;
            /** Roundid */
            roundId: string;
        };
        /**
         * ScoringConfig
         * @description MVP chỉ hỗ trợ 'direct' — xem decision 0002.
         *
         *     `rankPoints` và `bonuses` là LUẬT NHÀ, không phải chế độ tính điểm mới:
         *     điểm vẫn vào sổ dưới dạng delta từng người, `zeroSum` vẫn là cổng cuối. Luật
         *     nhà chỉ rút ngắn quãng đường từ "Nam nhất, Lan nhì" tới bốn con số đó.
         */
        ScoringConfig: {
            /**
             * Allownegative
             * @default true
             */
            allowNegative: boolean;
            /** Bonuses */
            bonuses: components["schemas"]["HouseBonus"][];
            /**
             * Mode
             * @default direct
             * @constant
             */
            mode: "direct";
            /** Rankpoints */
            rankPoints: number[] | null;
            /**
             * Startingscore
             * @default 0
             */
            startingScore: number;
            /**
             * Zerosum
             * @default true
             */
            zeroSum: boolean;
        };
        /** Session */
        Session: {
            /**
             * Confirmbeforecommit
             * @default true
             */
            confirmBeforeCommit: boolean;
            /** Createdat */
            createdAt: string;
            /** Deviceid */
            deviceId: string | null;
            /** Endedat */
            endedAt: string | null;
            /** Id */
            id: string;
            /** Meplayerid */
            mePlayerId: string | null;
            /** Name */
            name: string | null;
            /** Players */
            players: components["schemas"]["Player"][];
            /** Rounds */
            rounds: components["schemas"]["Round"][];
            scoringConfig: components["schemas"]["ScoringConfig"];
            /**
             * Status
             * @default active
             * @enum {string}
             */
            status: "active" | "ended";
            /** Undodepth */
            undoDepth: number | null;
        };
        /**
         * SessionView
         * @description Phiên và bảng điểm luôn về cùng nhau — client KHÔNG tự tính điểm nữa.
         */
        SessionView: {
            scoreboard: components["schemas"]["Scoreboard"];
            session: components["schemas"]["Session"];
        };
        /**
         * UiIntents
         * @description Việc client phải tự làm: thứ tự bảng là tuỳ chọn hiển thị (ADR 5).
         */
        UiIntents: {
            /** Roundorder */
            roundOrder: ("newest-last" | "newest-first") | null;
        };
        /** UndoState */
        UndoState: {
            /** Redo */
            redo: string | null;
            /** Undo */
            undo: string | null;
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    create_api_sessions_post: {
        parameters: {
            query?: never;
            header?: {
                "x-device-id"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_api_sessions__post: {
        parameters: {
            query?: never;
            header?: {
                "x-device-id"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_one_api_sessions__session_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    speak_api_sessions__session_id__agent_post: {
        parameters: {
            query?: never;
            header?: {
                "x-device-id"?: string | null;
            };
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentReply"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    confirm_api_sessions__session_id__agent_confirm_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AgentReply"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    end_api_sessions__session_id__end_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    add_player_api_sessions__session_id__players_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    remove_player_api_sessions__session_id__players__player_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                player_id: string;
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    redo_api_sessions__session_id__redo_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabeledView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    record_api_sessions__session_id__rounds_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_api_sessions__session_id__rounds__round_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                round_id: string;
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_api_sessions__session_id__rounds__round_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                round_id: string;
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    events_api_sessions__session_id__rounds__round_id__events_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                round_id: string;
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EventsView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    settings_api_sessions__session_id__settings_patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    undo_api_sessions__session_id__undo_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LabeledView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    undo_state_api_sessions__session_id__undo_state_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UndoState"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    active_api_sessions_active_get: {
        parameters: {
            query?: never;
            header?: {
                "x-device-id"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActiveView"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorBody"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
