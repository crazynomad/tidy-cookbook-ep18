# 慧厨时光 · EP18 家庭自用版

用于绿皮火车 EP18 上线演示。一个部署实例供一个家庭使用，邀请码仅给需要加入的家人。

来源：[RUIIIOVO/tidy-cookbook](https://github.com/RUIIIOVO/tidy-cookbook)，保留原 MIT 许可。基于节目修订 `4c69464cea2bee3db6b3cc5d0349b9184bf70955`，包含新库迁移、家庭邀请码、免费 CPU 条件下的认证修复。

## 验证状态

**2026-11-06 新实例已完成官方 MCP 配置 + Wrangler 4.158.0 发布，15 项云端业务检查和重部署持久化通过。** [打开登录入口](https://ep18-family-kitchen-git.burn-wang.workers.dev)。主人／家人双账号、邀请码、实时点菜、订单、购物勾选、点评与退出失效均已验收。Git 自动构建未连接；真实手机／跨网络仍需本人验证。

[完整中文部署指南](docs/DEPLOY.zh-CN.md)。跟做时先将 `wrangler.example.jsonc` 复制为 `wrangler.jsonc`，再配置自己的 Worker、D1 和邀请码；本仓库的实际 `wrangler.jsonc` 指向节目独立测试实例，不能原样用于自己的账号。源程序中的配置模板不包含密码或 API token。

## 本地体验

需要 Node.js 24 和 pnpm 11.27.0。

```bash
pnpm install --frozen-lockfile
pnpm local:prepare
pnpm db:init:local
pnpm user:create --local
pnpm preview
```

主人密码与邀请码由本人设置，不发到聊天、截图或公开仓库。厨房是 Next.js 静态导出前端 + Workers API + D1 + SQLite Durable Objects，不是完整 Next.js SSR 的托管示例。

## Git 自动发布准备

可选，尚未实测连接：先完成新数据库初始化和本人账号设置，再连接 Cloudflare Workers Builds。MCP OAuth 不等于 Git 构建令牌；请本人审查部署令牌范围，不直接接受包含无关服务的默认权限。构建命令 `pnpm build`；部署命令 `pnpm exec wrangler deploy`；生产分支 `main`；根目录 `/`。数据库初始化不放进每次构建，不能因更新代码而重置家庭数据。

以上配置正在实测，最终以验证记录为准。平台许可、免费额度和实际网络访问须分别核对；不需要付费域名、R2、模型 API 或邮件服务。
