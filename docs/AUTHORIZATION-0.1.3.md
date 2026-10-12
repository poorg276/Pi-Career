# PiCareer 0.1.3 授权修复与验收

日期：2026-10-10。

## 原因与修复

浏览器原先在收到 OAuth 回调时就显示成功，令牌交换、解析及加密保存实际还没有完成。0.1.2 将这些后续错误统一显示为授权失败，无法判断具体失败阶段。

本次排查发现 Windows 使用系统代理 `127.0.0.1:7890`，而后台 Node 请求没有接入它。同一授权服务的无凭据 HEAD 探测，直连返回 403、经系统代理返回 405。该探测只说明网络路径不同，不代表真实账户授权成功。同时用合成令牌复现了 SDK 对部分合法 Base64URL 令牌的解析失败。旧版未保留详细诊断，因此不能确定用户当时命中了哪一处。

- 后台 OpenAI 授权、令牌刷新及 Codex 模型请求通过 Electron 解析 Windows 系统代理，并使用对应 HTTP／HTTPS 代理。无代理时使用系统返回的 DIRECT 路径。代理故障不静默绕过；不自动重复兑换授权码。
- 本地 OAuth 回调保持直连。其他模型供应商和自定义 API 的网络行为保持原样。Codex 使用 SSE 流式响应，避免 WebSocket 采用不同的代理路径。
- 修复登录、令牌刷新和模型调用的 Base64URL／UTF-8 解析，支持缺省填充，仍要求有效的账户标识。传给服务端的原始令牌不做改写。
- 浏览器回调页面改为“已收到授权结果”，明确最终结果应在 PiCareer 查看。弹窗分别显示交换令牌、验证令牌、保存凭据和刷新模型列表。
- 错误区分 HTTP 拒绝、网络/代理失败、令牌无效及本机保存失败。技术详情包含阶段、分类、HTTP 状态和诊断编号；SQLite 仅保留最近 50 条此类诊断，不记录授权码、令牌、账户标识、代理地址或完整回调 URL。
- 凭据已提交但模型目录同步失败时显示授权已保存，提供刷新模型列表按钮，不要求重复授权。凭据密文与索引使用同一事务提交。

## 上游兼容方式

没有修改本地 `pi-main` 或 `YxAgent`。PiCareer 在准备 SDK 副本时应用 `scripts/patch-sdk.mjs`；修改前必须通过 SHA256 和唯一替换位置校验，否则停止构建。副本的 `dist/picareer-compat.json` 记录修改前后摘要。OAuth 注册参数、PKCE、state、回调端口和令牌交换协议保持不变。

本地 SDK 源码摘要仍为 `b4f2d31cc38be3a3fa181235d85d1395eacb17ef79a4463115ad6d4217d67abc`。

## 验证结果

- `npm run check` 通过；单元/核心回归 33 项通过。
- 真实 Pi SDK + 本地 HTTPS 模拟令牌服务：浏览器回调、URL-safe 字符与中文长令牌、缺少账户标识、损坏令牌、字段缺失、令牌刷新及 SSE 回复通过。
- 本地代理：令牌交换、刷新令牌和模型请求均确实经过 CONNECT 代理；失败时不绕过代理。HTTP 403、连接断开、请求超时、取消及重试通过。
- 实际 Electron + Windows safeStorage：长 OAuth 凭据加密保存、重启解密、过期令牌自动刷新和模型流式回复通过。模拟服务证书只在隔离测试进程信任，未安装到系统证书库，也未关闭证书验证。
- 125% 与 150% 缩放下，授权弹窗、按钮、错误与技术详情可见。自动打开浏览器、手动输入、取消释放端口、旧链接拒绝、端口占用、浏览器打开失败和后台退出回归通过。
- 原有自定义 API、凭据加密、上下文恢复、工具允许/拒绝、模型限流/失效/断网、8 题面试和 113 条学习计划集成回归通过。

证据文件见 `docs/evidence/codex-0.1.3-125.json`、`codex-0.1.3-150.json`、`authorization-0.1.3-125.json`、`authorization-0.1.3-150.json` 和 `integration-0.1.3.json`。发布目录及安装路径的复核结果分别记录在 `codex-packaged-0.1.3.json` 和 `installed-0.1.3.json`。

主要复现命令：

```powershell
node scripts/prepare-sdk.mjs
npm run check
node --test --test-isolation=none tests/*.test.ts
npm run build
node scripts/codex-desktop-check.mjs
node scripts/authorization-check.mjs
node scripts/integration.mjs
```

`PICAREER_SCALE=1.25` 或 `1.5` 设置测试缩放；`PICAREER_EXE` 可指定安装版或便携版。桌面测试只使用隔离数据。打包可复用已下载的运行时：`electron-builder --win nsis zip --publish never --config.electronDist=node_modules/electron/dist`。

## 安装交付

已覆盖更新 `C:\Users\HP\AppData\Local\Programs\PiCareer\PiCareer.exe` 至 0.1.3，安装退出码为 0。主程序、app.asar、后台 worker 与 SDK 补丁清单的 SHA256 均与最终发布目录一致；更新前后正常用户 SQLite 数据库 SHA256 完全一致，桌面快捷方式目标正确。

已安装程序在隔离数据目录再次通过完整代理授权、长令牌 Windows 加密、重启恢复、令牌刷新和 SSE 测试，结果见 `docs/evidence/codex-installed-0.1.3.json`。此次验证未登录真实账户。

交付 `release/PiCareer-0.1.3-x64.exe`、`PiCareer-0.1.3-x64.zip`、`PiCareer-0.1.3-source.zip`，并提供 `SHA256SUMS-0.1.3.txt`。源码包包含 PiCareer 源码、SDK 兼容补丁、测试和验收记录；开发仍需同级原始 `pi-main`，按 README 准备依赖与 SDK。

## 更新后操作与未验证项

**真实 OpenAI 账户登录、订阅权限及真实模型调用仍未验证。** 自动化合成令牌不能替代真实账号验收。本次也未重新执行干净 Windows 环境的安装卸载测试。

打开更新后的 PiCareer，在“模型与设置 → OpenAI Codex”重新连接，保持应用开启，在浏览器完成账号授权。浏览器出现“已收到授权结果”后，返回 PiCareer 等待“已授权”，再选择模型、保存并测试连接。旧回调链接不能用于新的授权尝试。

若仍失败，请提供弹窗技术详情中的错误分类、HTTP 状态和诊断编号即可，无需提供浏览器回调地址、授权码或令牌。系统代理目前支持 HTTP／HTTPS；不支持的代理类型会明确提示。更新保留现有用户数据、模型配置及桌面快捷方式。
