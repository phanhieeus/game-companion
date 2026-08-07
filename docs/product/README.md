# Product Docs

This directory contains current consumer-product behavior derived from real
accepted intent. Harness deliberately ships no fake product domains.

When a user provides a product specification, derive smaller living documents
here instead of keeping one growing specification as the operating manual. Name
files after actual product domains, such as `overview.md`, `billing.md`,
`permissions.md`, or `api-conventions.md`.

## Current Product Contract

Voice Card Scoring MVP — điều khiển bằng giọng nói để ghi điểm và tra cứu điểm
cho game đánh bài 4–5 người.

- [`overview.md`](overview.md) — mục tiêu, phạm vi, khái niệm cốt lõi. **Bắt đầu ở đây.**
- [`scoring.md`](scoring.md) — cấu hình điểm, data model, cách tính scoreboard.
- [`voice-pipeline.md`](voice-pipeline.md) — state machine của một lượt nói.
- [`conversation.md`](conversation.md) — intent, trích tham số, xác nhận/làm rõ/sửa lỗi.
- [`tools.md`](tools.md) — hợp đồng các hàm ghi/tra cứu và mã lỗi.
- [`open-questions.md`](open-questions.md) — **chưa chốt; đọc trước khi build.**

Bản spec gốc đóng băng làm provenance nằm ở [`SPEC.md`](../../SPEC.md) (v1.1).
Nó **không phải** operating manual — khi behavior đổi, sửa các file trên.

## Update Rule

When behavior changes:

1. Update the affected product document when the expected behavior changed.
2. Update the active execution plan when complex work uses one.
3. Add a lasting decision only when future work must inherit a consequential
   product, architecture, data, security, compatibility, or validation choice.
4. Add or update executable proof that exercises the behavior.

Bounded changes do not require a story packet, proof-matrix row, or Harness CLI
mutation.
