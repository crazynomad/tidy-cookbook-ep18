# 慧厨时光：家庭自用免费部署跟做版

更新：2026-11-04。基于上游 `RUIIIOVO/tidy-cookbook` 的 `bd6c7fe66192bdef92ef152c64250adc3c407257`，修改分支 `codex/ep18-free-deploy`。

**这是修改版的教程。修改版目前只在节目制作本地仓库，尚未发布公开下载地址。直接 clone 上游后不能照抄下列新增命令。正式提供给观众前，需要发布这一修改分支的固定版本，并把此处换成真实仓库与 commit/tag；不要填一个尚不存在的下载地址。**

当前验证：本地及真实公网双账号流程已通过，重新部署后订单与点评仍保留。账户 Workers Free 由账号本人确认，Dashboard 套餐页未能独立核验，未检查实际账单。没有升级套餐或启用付费项。两台真实设备、移动网络与长期额度仍需自行验收。

节目制作仓库另保存了 `tidy-cookbook-ep18.patch`，可在固定上游基线上复原本修改版。公开提供给观众前，先发布这个补丁或包含修改的源码；下方本地路径应换成实际下载位置：

```bash
git clone https://github.com/RUIIIOVO/tidy-cookbook.git tidy-cookbook-ep18
cd tidy-cookbook-ep18
git switch -c ep18-demo bd6c7fe66192bdef92ef152c64250adc3c407257
git apply --check /实际下载位置/tidy-cookbook-ep18.patch
git apply /实际下载位置/tidy-cookbook-ep18.patch
```

补丁仅包含源码、配置模板和文档；不会提供任何可登录真实厨房的密码或邀请码。


## 最终会得到什么

一个 `https://你的项目名.你的账号子域名.workers.dev` 网站。自己作为厨房主人，家人拿到网址和邀请码后注册自己的账号，大家共用点菜单、订单和买菜勾选。

这不是多个家庭隔离的 SaaS：一个部署实例就是一个家庭厨房。请只把邀请码交给需要加入的人。

前端用 Next.js 构建成静态文件；后端是 Cloudflare Workers，数据保存在 D1，实时同步由 SQLite Durable Objects 提供。这是 Next.js 前端配独立后端的动态应用，不是演示 Next.js SSR 或 Server Actions 的部署。不需要模型 API、邮箱发送服务、R2 或付费域名。可选 Bark 推送不在这条跟做流程里。

## 先在自己电脑验证

需要 Node.js 24 LTS 和 pnpm 11.27.0。取得上面说明的修改版后，在项目目录运行：

```bash
pnpm install --frozen-lockfile
pnpm local:prepare
pnpm db:init:local
pnpm user:create --local
pnpm preview
```

- `local:prepare` 生成随机家庭邀请码并存到 `.dev.vars`；文件被 Git 忽略。在编辑器里查看，不要把它录进视频或提交仓库。
- `db:init:local` 使用独立的 `migrations-fresh/` 新装基线。重复执行会显示无新迁移。不要再执行旧目录 `migrations/` 的升级脚本，也不要先执行 `schema.sql` 后再跑迁移。
- `user:create` 依次询问用户名、显示名、密码；密码输入不回显，不进入命令历史。用户名已存在会失败，不会替换原账号。
- `preview` 构建前端并启动包含 D1、WebSocket 的完整本地环境。只运行 `pnpm dev` 是前端开发服务，不能验证整条后端流程。

打开终端显示的本地地址。用主人账号登录；再用无痕窗口，凭 `.dev.vars` 里的邀请码注册一个家人账号。两边点菜应该同步。

关闭本地服务后数据保留在 `.wrangler/`，重启仍可读到；它不是云端数据库，本地测试数据不会自动传到云端。

## 发布到自己的 Cloudflare

### 1. 登录并确认免费套餐

注册 Cloudflare 账号、验证邮箱。在 Dashboard 中确认 Workers 为 **Free**。本教程不需要升级套餐、购买域名或开通付费服务。

```bash
pnpm exec wrangler login --device --browser=false --scopes account:read user:read workers_scripts:write d1:write workers_tail:read
pnpm exec wrangler whoami
```

终端会给出验证网址和一次性设备码。本人打开网址、登录 Cloudflare、输入设备码并授权；保留终端等待，直到出现 `Successfully logged in`。设备码不要发给别人。实测这条设备授权流程成功；本轮使用 Wrangler 4.135.0，默认 localhost 回调在实测中于 120 秒后关闭端口，浏览器再完成登录也不能把凭据交回 CLI。超时后重新运行设备授权命令，使用新码。

备用是 `pnpm exec wrangler login --scopes account:read user:read workers_scripts:write d1:write workers_tail:read` 的本地回调方式。界面已登录不代表 CLI 已授权，以 `whoami` 成功为准。上述最小 scopes 可能触发 Wrangler 的「缺少默认 scopes」警告；不为消除警告添加 R2、AI、域名等无关权限，仅在实际操作出现明确权限错误时处理。

`whoami` 只确认登录账号与权限，不证明套餐为 Free。如果已有账户是 Paid，不要为了教程降级或改动已有订阅；应注明测试条件，或使用符合条件的独立 Free 账户验证。若 Dashboard 一直加载，先由账号本人确认当前套餐，再继续部署。

### 2. 新建自己的数据库

在 `wrangler.jsonc` 中把 `name` 和 `database_name` 换成自己的项目名，例如 `my-family-kitchen`。保留 `workers_dev: true`，无需添加 `routes`。

```bash
pnpm exec wrangler d1 create my-family-kitchen
```

把输出的 `database_id` 填到 `wrangler.jsonc` 的 D1 配置中，替换全零占位值。多账户用户还需要在配置中指定本人确认的 `account_id`。此 ID 是资源标识，不是 API token；绝对不要复制作者的 ID。

```bash
pnpm db:init:remote
pnpm user:create --remote
```

这两步分别初始化云端新库和创建云端主人账号。使用新创建的数据库，别套用到已有上游实例；旧库升级需要单独制定迁移步骤。

### 3. 发布网站，设置邀请码

```bash
pnpm deploy
pnpm exec wrangler secret put KITCHEN_INVITE_CODE
```

第二条命令会提示输入家庭邀请码。推荐使用密码管理器生成较长的随机值，再私下分享给家人；它与每个人的登录密码不同。只需录制操作步骤，不录真实值。邀请码未设置时注册默认关闭，已创建的主人仍能登录。

若首次使用 Workers 提示选择账号子域名，按界面选择；免费地址使用 `workers.dev`。不要为完成教程而绑定信用卡或开通收费套餐。部署后以 Wrangler 实际输出为准，不预先拼一个假成功网址。

### 4. 验收

1. 从公网地址打开首页，主人能登录。
2. 另一台设备用邀请码注册；没有邀请码的人无法加入。
3. A 加一道菜，B 无需刷新看到变化。
4. 下单、勾选购物项、写一条点评，另一账号能看到。
5. 刷新、关闭页面再打开，订单和点评仍保留。
6. 使用手机移动网络访问。不同地区访问平台子域名的情况需要实际测试，不能保证国内所有网络都畅通。
7. 在 Cloudflare 检查 Workers 套餐与用量、D1 用量；检查登录和同步请求没有 CPU 超限或额度错误。本地的请求耗时不等于云端 CPU 时间。

## 更新和备份

改文案／菜谱后重新执行 `pnpm deploy`，不会因为部署前端而清空 D1。新增菜谱按仓库规则维护 `src/data/raw.ts`，然后运行 `node scripts/build-pinyin.mjs`；核心演示不需要生成新图片。

备份云端数据可使用：

```bash
pnpm exec wrangler d1 export DB --remote --output=./kitchen-backup.sql
```

备份含家庭账号哈希及订单数据，应放到私人备份位置，不提交公开仓库。不要删除 D1 或用本地测试库覆盖云端库。上游旧 migrations 不适用于这个新装基线；将来引入结构变动时需要新增、核查对应迁移。

## 免费范围与验证边界

截至 2026-11-04，官方文档提供以下免费额度：Workers 动态请求 100,000 次/日、CPU 10 ms/次；D1 读 500 万行/日、写 10 万行/日、合计 5 GB；SQLite Durable Objects 请求 100,000 次/日、时长 13,000 GB-s/日。由静态资源系统直接处理的资源请求不收请求费。额度规则可能更新，超额可能导致服务拒绝请求；“免费额度内可运行”不等于永久无限免费。

本修改版把登录与注册的密码计算、数据库限流和会话操作放在已有的 SQLite Durable Object 内部执行，保留 PBKDF2-SHA256 的 100,000 轮。实测原版认证路径会超过普通 Worker 的 10 ms；不能因一次请求返回成功就认为符合限制。DO 默认每次请求可用 30 秒 CPU，但仍有每日请求和时长额度。必须应用完整补丁，不要只复制配置模板。

来源：[Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)、[Durable Objects 价格](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[静态资源计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)。

本地与公网已验证账号、邀请码、两个独立登录连接实时同步、下单、购物勾选、点评，以及本地重启／云端重部署后的数据保留。公网浏览器登录、菜单直达刷新、历史订单展示也通过。最终一轮认证样本中，普通 Worker 登录 CPU 1–3 ms、注册 1 ms；DO 登录 19–21 ms、成功注册 19 ms。这是有限样本，不是性能或长期免费保证。

尚未验证两台真实设备、手机移动网络、不同地区可达性、Cron 实际定时触发及长期额度／账单。实测曾出现一次到 workers.dev 的连接超时，重试完成；请保留自己的网络验收步骤。
