import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";

const path = new URL("../.dev.vars", import.meta.url);
if (!existsSync(path)) {
  writeFileSync(path, `KITCHEN_INVITE_CODE=${randomBytes(16).toString("hex")}\n`, { mode: 0o600 });
}
console.log("本地邀请码保存在 .dev.vars。它不进入 Git；请在编辑器中查看并只分享给家人。");
console.log("接着运行 pnpm db:init:local、pnpm user:create --local，再 pnpm preview。");
