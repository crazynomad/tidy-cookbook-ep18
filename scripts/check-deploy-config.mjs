import { readFileSync } from "node:fs";

// The viewer config is JSON (also valid JSONC), so validation needs no extra dependency.
const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const id = config.d1_databases?.find((db) => db.binding === "DB")?.database_id;
if (!id || id === "00000000-0000-0000-0000-000000000000") {
  console.error("请先创建自己的 D1 数据库，把 database_id 填入 wrangler.jsonc。当前占位配置只能本地运行。");
  process.exit(1);
}
if (config.routes || config.env || config.vars?.TRIAL || !config.workers_dev) {
  console.error("本教程只部署独立的 workers.dev 实例，不使用作者域名或公测试用环境。");
  process.exit(1);
}
console.log(`部署目标：${config.name}（使用自己的 D1 和 workers.dev 子域名）`);
