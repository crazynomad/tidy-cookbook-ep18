/** 仅由 KitchenDO 内部入口调用；保持原认证、限流和 cookie 语义。 */
import { clearLoginFail, login, loginBlockedFor, recordLoginFail, register, sessionCookie } from "./auth";

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers },
  });
const str = (v: unknown) => typeof v === "string" ? v : "";
async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" ? v as Record<string, unknown> : {};
  } catch { return {}; }
}

export async function handleAuthRequest(
  req: Request,
  env: { DB: D1Database; KITCHEN_INVITE_CODE?: string },
): Promise<Response> {
  const url = new URL(req.url);
  // ── 不需要登录 ────────────────────────────────
  if (url.pathname === "/internal/login" && req.method === "POST") {
    const body = await readBody(req);
    const username = str(body.username).trim();
    const password = str(body.password);
    if (!username || !password) return json({ error: "请填用户名和密码" }, { status: 400 });
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const wait = await loginBlockedFor(env.DB, username, ip);
    if (wait > 0)
      return json(
        { error: `尝试次数太多，请 ${Math.ceil(wait / 60_000)} 分钟后再试` },
        { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
      );
    const r = await login(env.DB, username, password);
    if (!r) {
      await recordLoginFail(env.DB, username, ip);
      return json({ error: "用户名或密码错误" }, { status: 401 });
    }
    await clearLoginFail(env.DB, username);
    return json(
      { user: r.user, token: r.token },
      { headers: { "Set-Cookie": sessionCookie(r.token) } },
    );
  }

  if (url.pathname === "/internal/register" && req.method === "POST") {
    const body = await readBody(req);
    const username = str(body.username).trim();
    const password = str(body.password);
    if (!username || !password) return json({ error: "请填用户名和密码" }, { status: 400 });
    if (!env.KITCHEN_INVITE_CODE)
      return json({ error: "厨房暂未开放加入，请联系主人" }, { status: 403 });
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const registerKey = `register:${ip}`;
    const wait = await loginBlockedFor(env.DB, registerKey, registerKey);
    if (wait > 0)
      return json({ error: "尝试次数太多，请稍后再试" }, {
        status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) },
      });
    // Hash both values to fixed-size buffers before comparing. Never return the invitation code.
    const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    const [provided, expected] = await Promise.all([
      digest(str(body.inviteCode)), digest(env.KITCHEN_INVITE_CODE),
    ]);
    const a = new Uint8Array(provided), b = new Uint8Array(expected);
    let difference = 0;
    for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
    if (difference !== 0) {
      await recordLoginFail(env.DB, registerKey, registerKey);
      return json({ error: "邀请码不正确，请向主人确认" }, { status: 403 });
    }
    const r = await register(env.DB, username, password, str(body.displayName) || username);
    if ("error" in r) return json(r, { status: 400 });
    return json(
      { user: r.user, token: r.token },
      { headers: { "Set-Cookie": sessionCookie(r.token) } },
    );
  }

  return json({ error: "未找到" }, { status: 404 });
}
