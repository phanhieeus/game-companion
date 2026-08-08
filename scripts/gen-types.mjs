/**
 * Sinh kiểu TypeScript cho client từ OpenAPI của FastAPI (ADR 17).
 *
 * Backend Python và client TypeScript không còn chung `shared/types.ts`. Khai
 * `Session`/`Round` ở hai nơi thì sớm muộn cũng lệch, mà lệch kiểu này IM LẶNG:
 * pytest xanh, vitest xanh, chỉ người dùng thấy sai. Đây là chỗ máy canh hộ.
 *
 * Không cần server đang chạy — gọi thẳng `app.openapi()`.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import openapiTS, { astToString } from "openapi-typescript";

const spec = JSON.parse(
  execFileSync(
    ".venv/bin/python",
    ["-c", "import os;os.environ['DATA_DIR']='/tmp/gc-openapi';import json;from api.main import app;print(json.dumps(app.openapi()))"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ),
);

const ast = await openapiTS(spec, { alphabetize: true });
const body = astToString(ast);

const header = `/**
 * SINH TỰ ĐỘNG — ĐỪNG SỬA TAY.
 *
 * Nguồn: OpenAPI của FastAPI (api/routes/schemas.py). Chạy lại bằng:
 *   npm run gen:types
 *
 * File này được commit để đọc diff là thấy hợp đồng đổi chỗ nào (ADR 17).
 */

`;

writeFileSync("src/api/types.ts", header + body, "utf8");
console.log("đã sinh src/api/types.ts");
