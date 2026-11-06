// Integration smoke test. Cloud mode requires this task's explicit saved deployment URL; credentials are never printed.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

const cloud = process.argv.includes("--cloud");
const resources = cloud ? JSON.parse(readFileSync(".ep18-local/cloud-resources.json", "utf8")) : null;
const base = cloud ? resources.url : "http://127.0.0.1:8787";
if (cloud && (new URL(base).protocol !== "https:" || new URL(base).hostname !== "ep18-family-kitchen-git.burn-wang.workers.dev"))
  throw new Error("Cloud verification is restricted to the saved EP18 workers.dev instance.");
const credentials = JSON.parse(readFileSync(cloud ? ".ep18-local/cloud-credentials.json" : ".ep18-local/test-owner.json", "utf8"));
const owner = cloud ? credentials.owner : credentials;
const inviteCode = cloud ? credentials.inviteCode : readFileSync(".dev.vars", "utf8").match(/^KITCHEN_INVITE_CODE=(.+)$/m)?.[1];
const resultPath = cloud ? ".ep18-local/cloud-result.json" : ".ep18-local/result.json";
const reviewComment = cloud ? "公网验证：下饭神器" : "本地验证：下饭神器";
const calls = [];
async function request(path, body, token, expected = 200) {
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `${path}: unexpected HTTP status`);
  if (expected === 200 && ["/api/login", "/api/register"].includes(path)) {
    const cookie = response.headers.get("set-cookie") ?? "";
    assert.ok(cookie.includes("HttpOnly") && cookie.includes("Secure") && cookie.includes("SameSite=Lax"), "session cookie flags changed");
  }
  return response.json();
}
function report(message) { calls.push(message); console.log(`PASS ${message}`); }
async function connect(token) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/api/sync?v=2", [`auth.${token}`]);
  const pending = [], inbox = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const index = pending.findIndex((wait) => wait.match(message));
    if (index < 0) inbox.push(message);
    else { const [wait] = pending.splice(index, 1); clearTimeout(wait.timer); wait.resolve(message); }
  });
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
  const wait = (match) => {
    const index = inbox.findIndex(match);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = { match, resolve, timer: setTimeout(() => { const i = pending.indexOf(item); if (i >= 0) pending.splice(i, 1); reject(new Error("WebSocket response timeout")); }, 6000) };
      pending.push(item);
    });
  };
  return { ws, wait, send: (message) => ws.send(JSON.stringify(message)) };
}

const login = await request("/api/login", owner);
assert.equal(login.user.role, "owner");
report("owner login");
if (process.argv.includes("--verify-persistence")) {
  const saved = JSON.parse(readFileSync(resultPath, "utf8"));
  const history = await request("/api/history", undefined, login.token);
  const meal = history.meals.find((m) => m.id === saved.mealId);
  assert.ok(meal, "order absent after restart");
  const reviews = await request(`/api/reviews?ids=${saved.mealId}`, undefined, login.token);
  assert.equal(reviews.reviews[0].comment, saved.reviewComment ?? "本地验证：下饭神器");
  report(cloud ? "order and review persist after redeployment" : "order and review persist after full worker restart");
  process.exit(0);
}

await request("/api/login", { username: owner.username, password: "incorrect-password" }, undefined, 401);
await request("/api/login", { username: "missing_" + randomBytes(3).toString("hex"), password: "incorrect-password" }, undefined, 401);
report("wrong-password and nonexistent-account logins rejected");

for (const path of ["/internal/login", "/api/internal/login", "/internal/register", "/api/internal/register"]) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ password: "example", saltHex: "00".repeat(16) }) });
  assert.equal(response.status, 404, "internal authentication routes must not be publicly routed");
}
report("internal authentication endpoints are not publicly routed");

await request("/api/me", undefined, undefined, 401);
await request("/api/history", undefined, undefined, 401);
await request("/api/sync?v=2", undefined, undefined, 401);
await request("/api/sync?v=2", undefined, "invalid-session", 401);
await request("/api/sync?v=2", undefined, login.token, 426);
report("WebSocket endpoint rejects anonymous/invalid sessions and non-upgrade requests");
report("anonymous data access denied");
const guest = { username: `g${randomBytes(5).toString("hex")}`, password: randomBytes(18).toString("hex"), displayName: "家人甲" };
await request("/api/register", { ...guest, inviteCode: "incorrect" }, undefined, 403);
await request("/api/register", guest, undefined, 403);
report("missing/wrong invitation denied");
const registered = await request("/api/register", { ...guest, inviteCode });
assert.equal(registered.user.role, "guest");
report("invited account joins as guest");
const a = await connect(login.token), b = await connect(registered.token);
try {
  const initial = await a.wait((m) => m.type === "snapshot");
  await b.wait((m) => m.type === "snapshot");
  a.send({ type: "set", dishId: "1", qty: 2, ts: Date.now() });
  await b.wait((m) => m.type === "snapshot" && m.items.some((i) => i.dishId === "1" && i.qty === 2));
  report("two independent authenticated connections synchronize cart");
  b.send({ type: "clear", ts: Date.now() });
  await b.wait((m) => m.type === "denied");
  report("guest cannot clear family cart");
  const nextRev = (initial.meals.find((m) => m.mealDate === initial.today && m.slot === 3)?.rev ?? 0) + 1;
  const requestId = randomUUID();
  const order = { type: "placeOrder", reqId: requestId, date: initial.today, slot: 3, items: [{ dishId: "1", qty: 2 }] };
  b.send(order);
  const ack = await b.wait((m) => m.type === "ack" && m.reqId === requestId);
  assert.equal(ack.ok, true);
  const snapshot = await a.wait((m) => m.type === "snapshot" && m.meals.some((meal) => meal.id === ack.mealId && meal.rev >= nextRev));
  const meal = snapshot.meals.find((m) => m.id === ack.mealId);
  report("guest places order; owner receives order");
  b.send(order);
  const repeat = await b.wait((m) => m.type === "ack" && m.reqId === requestId);
  assert.equal(repeat.mealId, ack.mealId);
  report("retrying order is idempotent");
  const buyId = randomUUID();
  b.send({ type: "buy", reqId: buyId, mealIds: [meal.id], name: "螺丝椒", done: true });
  assert.equal((await b.wait((m) => m.type === "ack" && m.reqId === buyId)).ok, true);
  await a.wait((m) => m.type === "snapshot" && m.bought.some((i) => i.mealId === meal.id && i.name === "螺丝椒"));
  report("shopping checkmark synchronizes");
  const yesterday = new Date(new Date(initial.today + "T12:00:00Z").valueOf() - 86400000).toISOString().slice(0, 10);
  const saveId = randomUUID();
  a.send({ type: "saveMeal", reqId: saveId, mealId: meal.id, rev: meal.rev, date: yesterday, slot: 3, items: meal.items });
  const savedOrder = await a.wait((m) => m.type === "ack" && m.reqId === saveId);
  assert.equal(savedOrder.ok, true);
  const finalMealId = savedOrder.mealId;
  assert.ok(finalMealId, "save must return the final order ID, including after merging");
  const denyId = randomUUID();
  b.send({ type: "deleteMeal", reqId: denyId, mealId: finalMealId });
  const denied = await b.wait((m) => m.type === "ack" && m.reqId === denyId);
  assert.equal(denied.code, "forbidden");
  report("guest cannot delete historical order");
  await request("/api/reviews", { mealId: finalMealId, rating: 5, tags: ["下饭神器"], dishRatings: { "1": 5 }, comment: reviewComment }, registered.token);
  const reviews = await request(`/api/reviews?ids=${finalMealId}`, undefined, login.token);
  assert.equal(reviews.reviews[0].rating, 5);
  report("review written by guest and read by owner");
  await request("/api/logout", {}, registered.token);
  await request("/api/me", undefined, registered.token, 401);
  report("logout revokes HTTP session");
  writeFileSync(resultPath, JSON.stringify({ at: new Date().toISOString(), mealId: finalMealId, reviewComment, checks: calls }, null, 2));
} finally {
  a.ws.close(); b.ws.close();
}
