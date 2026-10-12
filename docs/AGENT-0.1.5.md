# PiCareer 0.1.5 修复与验收

日期：2026-10-10。目标环境：当前 Windows 用户、本机系统代理、现有 OpenAI Codex 订阅授权。

## 改动

- 没有 Tavily Key 时，使用 Bing 和 DuckDuckGo HTML 搜索；可选 Tavily 失败后同样回退。结果保留实际引擎、来源、检索时间及备用原因。完全无查询词重叠的结果页不会直接视为有效搜索。
- 公开 HTML/文本直接读取，linkedom + Mozilla Readability 提取正文，不执行网页脚本。与搜索摘要分别标记；登录限制、验证码、限流、超时及正文不足均有真实错误。
- 公开网页请求使用独立非持久 Electron session，系统代理失败不改为直连。地址/DNS/重定向校验、20 秒请求超时、2 MiB 正文限制与取消操作均生效。
- 右键菜单提供删除确认，生成中先停止；同时删除业务记录和独占的 Pi 会话文件，不删除项目文件。持久删除标记与前端删除集合防止迟到输出恢复记录。
- 聊天页顶部栏移除，保留标题和工作目录；模型名称移到输入框左下角，点击可进入设置。
- 每轮保存完成、停止、失败或中断状态，显示一次结束行。Context 来自 Pi SDK 的 `getContextUsage()`，按模型目录容量显示估算余量；未知容量、未知用量和旧记录不编造数字。

## 已完成的验证

| 项目 | 方法与结果 |
|---|---|
| 类型与单元回归 | TypeScript 检查通过；51 项测试通过，含搜索解析/去重/备用/相关性、公开地址限制、取消、超时、删除清理和重启恢复 |
| Electron 聊天 | 开发版及最终发布包在 125% 和 150% 下验证布局、Markdown、中文输入法、侧栏重命名、项目说明与 Skills、真实 Pi 文件工具和 PowerShell、多步调用、停止、后台退出恢复；发布包另检查小窗口长模型名省略与删除确认 Esc 取消 |
| 删除流程 | 隔离数据中验证生成中删除、迟到事件、重复删除、最后一条删除、项目文件保留；单元测试覆盖共享会话文件及清理中断后的恢复 |
| 模拟联网 | 本地 HTTPS 代理提供合成搜索页和正文；验证没有 Key 时搜索/读取成功，Bing 验证页切换到 DuckDuckGo，并记录实际代理路径 |
| 授权兼容 | 实际 Electron + 真实 Pi SDK + 模拟令牌服务验证登录、Windows 长凭据加密、重启恢复、刷新、HTTP 错误、取消、SSE 与真实 SDK Context 统计 |
| 其他模块 | 发布包使用隔离数据验证自定义 API、面试 8 题与暂停恢复、113 条学习计划及两次阶段测验、文件操作审批与后台退出；搜索不可用时显示 JD-only 提示。桌面点击 Hot100 载入参考解并通过随包 Python 判题，背诵完成首批；岗位条件与去重由单元测试验证 |
| 真实账号与网络 | 无 Tavily Key，使用现有 openai-codex / gpt-6-astra 完成中文 EDG 资料查询及英文 Electron 文档检索，实际读取公开正文，并保存 SDK Context 用量；最终发布包再次完成英文检索与官方正文读取 |

真实测试中，部分搜索请求没有结果或遇到验证、个别原文 HTTP 403；应用没有伪造成功，Agent 改用其他查询与来源。对 EDG 名单的日期与籍贯来源不足明确说明，没有以国籍代替籍贯或将旧阵容标成当前名单。

证据保留请求、来源网址、实际引擎、结果长度/摘要指纹与最终回复；不随源码分发整页抓取正文或用户凭据。用户数据内保留题为「0.1.5 验收：免密钥联网搜索」的真实测试对话。

记录：[真实联网](evidence/live-web-0.1.5.json)、[发布包真实联网](evidence/live-web-0.1.5-packaged.json)、[125% 桌面](evidence/chat-0.1.5-packaged-125.json)、[150% 桌面](evidence/chat-0.1.5-packaged-150.json)、[授权回归](evidence/codex-0.1.5-packaged.json)、[集成回归](evidence/integration-0.1.5-packaged.json)、[刷题与背诵入口](evidence/modules-0.1.5-packaged.json)。授权回归使用模拟令牌服务，其 `realAccountLogin` 为未验证；现有真实账号的验证以真实联网记录为准。

## 发布状态

0.1.5 已通过上述发布包验证，并覆盖安装到当前用户的 PiCareer。安装前后数据库 SHA-256 一致；桌面快捷方式仍指向安装目录。安装后的实际启动检查确认版本、现有 OAuth、模型目录、4 条历史对话及已保存的 Context 正常恢复，所有业务记录保持不变。

- [覆盖安装记录](evidence/installed-0.1.5.json)、[安装后启动记录](evidence/installed-startup-0.1.5.json)、[便携 ZIP 完整性及关键文件比对](evidence/portable-0.1.5.json)。
- 安装包：`release/PiCareer-0.1.5-x64.exe`；便携包：`release/PiCareer-0.1.5-x64.zip`；源码包：`release/PiCareer-0.1.5-source.zip`。校验文件：`release/SHA256SUMS-0.1.5.txt`。
- [150% 小窗口截图](screenshots/chat-0.1.5-150.png)、[已安装应用截图](screenshots/installed-0.1.5.png)。

构建只修改 PiCareer 与随包 SDK 副本；逐一校验 `pi-main` 清单中 1,839 个文件均与既有摘要一致，`YxAgent` 未改动。源码包不包含用户数据库、授权凭据或依赖安装目录；构建方式见 README。

## 实际边界

- 免密钥公开搜索受网站验证、限流和页面结构变化影响；不绕过验证，不保证任何网站始终可读取。HTTP 错误不代表需要重新授权模型。
- 目前直接提取 HTML/纯文本，不执行网页 JavaScript，不登录第三方网站，不处理 PDF 二进制正文。
- Context 是会话上下文估算，不是订阅剩余额度。自定义 API 的窗口未确认时不展示百分比。
- 真实 Tavily API 未验证（用户未配置 Key）；其适配器与回退由模拟服务验证。本机测试不替代独立干净 Windows 虚拟机测试。

## 复现

```powershell
npm run check
npm test
npm run build
node scripts/chat-check.mjs
$env:PICAREER_SCALE='1.5'
node scripts/chat-check.mjs
node scripts/codex-desktop-check.mjs
node scripts/integration.mjs
# 明确使用现有账号并先备份用户数据，只新增/继续标注的验收对话：
node scripts/live-web-check.mjs --real-account
```

发布后可设置 `PICAREER_EXE` 指向 `release/win-unpacked/PiCareer.exe`，重跑桌面检查；`live-web-check.mjs --real-account --quick` 验证打包版英文检索及官方正文读取。
