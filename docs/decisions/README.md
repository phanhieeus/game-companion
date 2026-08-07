# Decisions

Decision records preserve lasting product, architecture, data ownership,
security, compatibility, and validation choices that future work must inherit.

Use `docs/templates/decision.md`. Task-local implementation choices remain in
the active execution plan and do not require a separate decision.

An installed consumer begins with no fabricated decisions. Add local decision
documents here as real choices are accepted, then index them in this file.

## Index

- [0001 — Giữ hợp đồng tool tương thích với plugin platform tương lai](0001-tool-contracts-forward-compatible-with-plugin-platform.md)
  (Proposed): vì sao MVP gọi hàm trực tiếp nhưng vẫn phải giữ nguyên tên/schema.
