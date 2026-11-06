import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawnSync } from "node:child_process";

const flags = process.argv.slice(2);
const remote = flags.includes("--remote"), local = flags.includes("--local");
if (remote === local) throw new Error("请选择 --local 或 --remote；不会默认操作云端。");
if (remote) await import("./check-deploy-config.mjs");

// --stdin is for local automated verification; secrets never enter process arguments.
let input;
if (flags.includes("--stdin")) {
  if (remote) throw new Error("云端创建账号请使用交互输入。");
  input = JSON.parse(readFileSync(0, "utf8"));
} else {
  if (!process.stdin.isTTY) throw new Error("请在交互终端运行此命令。");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await rl.question("主人用户名（2–16 位字母、数字、下划线）：")).trim();
  const displayName = (await rl.question("显示名：")).trim() || username;
  rl.close();
  const password = await new Promise((resolve, reject) => {
    process.stdout.write("密码（至少 12 位，输入不回显）：");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let text = "";
    const done = () => { process.stdin.setRawMode(false); process.stdin.off("data", receive); process.stdin.pause(); process.stdout.write("\n"); };
    const receive = (data) => {
      for (const ch of data.toString()) {
        if (ch === "\u0003") { done(); reject(new Error("已取消")); return; }
        if (ch === "\r" || ch === "\n") { done(); resolve(text); return; }
        if (ch === "\u007f" || ch === "\b") text = text.slice(0, -1);
        else if (ch >= " ") text += ch;
      }
    };
    process.stdin.on("data", receive);
  });
  input = { username, displayName, password };
}

const { username, password, displayName = username } = input;
if (!/^[a-zA-Z0-9_]{2,16}$/.test(username) || typeof password !== "string" || password.length < 12)
  throw new Error("用户名格式不正确，或密码不足 12 位。");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), 100_000, 32, "sha256").toString("hex");
const directory = mkdtempSync(join(tmpdir(), "tidy-owner-"));
const file = join(directory, "user.sql");
try {
  // Existing usernames cause a constraint error; never silently replace another family member.
  writeFileSync(file,
    `INSERT INTO user (id,username,display_name,pw_hash,pw_salt,role,kitchen_id,created_at) VALUES (${[randomBytes(8).toString("hex"), username, displayName, hash, salt, "owner", "main"].map(quote).join(",")},${Date.now()});\n`,
    { mode: 0o600 });
  const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", `--file=${file}`], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.status !== 0) {
    // Wrangler errors may echo SQL; don't leak hashes or the generated seed into terminal output.
    console.error("创建失败。请确认数据库已初始化、用户名没有重复、Wrangler 已登录（仅云端需要）。");
    process.exitCode = 1;
  } else console.log(`已在${remote ? "云端" : "本地"}创建厨房主人：${username}`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
