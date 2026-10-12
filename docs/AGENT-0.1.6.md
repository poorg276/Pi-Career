# PiCareer 0.1.6：聊天界面与对话产物清理

日期：2026-10-10。平台：本机 Windows x64。此版本仅改进通用 Agent，沿用现有 Pi SDK、模型授权与联网适配。

## 交付行为

- 聊天标题区压缩为 44 CSS px，标题 20px；移除英文标语、能力说明和联网入口，长标题悬停可读。工作目录按钮位于输入框底部、模型名称右侧。
- 每轮只有一个工具进度区：运行时最多三行，1.6 秒缓慢明暗变化，尊重系统减少动态效果。结束后收为一行；停止、中断及未恢复的工具错误使用不同文案。完整工具记录仍存于本机，前台不再显示原始参数和结果卡片；Context 结束提示继续保留。
- 新增按对话登记的新建文件清单。Pi `write` 新建文件自动登记，`edit` 更新已登记文件指纹；原有文件不会变成新建产物。PowerShell 可通过 `outputPaths` 声明预期文件，Skills 脚本同样适用。未声明的命令产物不从文本猜测归属。
- 删除入口先停止该对话的任务，再显示清理预览。确认后把核验通过的新建文件移入 Windows 回收站；内容变更、文件替换、链接、其他对话引用的文件会跳过并说明。原有文件移动后的新路径不会据此认领为新建文件。
- 每次清理前复核路径、工作目录身份、文件身份和 SHA-256；清单变化要求重新确认。只清理由本对话创建、未共享且为空的子目录，保留工作目录根目录。回收失败留在弹窗供重试，逐项结果持久化，重启后可再次预览并继续。

## 接口与数据

- 新增 `previewDeleteChat({ id })`，返回清理清单、跳过原因、未登记命令数量及清单 token。运行中调用会等待停止完成。
- `deleteChat({ id, token })` 返回删除成功、清单已变化或可重试错误；清理期间与聊天执行互斥，沿用 `chatDeleted` 和删除标记防止迟到输出恢复记录。没有有效 token 不执行文件清理。
- `ChatRun.phase` 保存准备、思考、工具和回答阶段；界面按 `turnId` 聚合。只消费 SDK 的状态事件，不输出内部推理正文。
- SQLite 新增产物归属、未登记命令和清理任务记录，兼容旧聊天。旧数据无归属记录时不从工具文本推断磁盘所有权；应用会按既有机制备份数据库。
- 文件回收仅由后台经主进程专用通道调用 `shell.trashItem`，界面没有任意路径删除接口；不修改上游 `pi-main` 或 `YxAgent`。

## 验证记录

| 项目 | 当前结果 |
|---|---|
| 类型检查、单元回归 | 已通过 TypeScript 与 62 项测试，含新建/修改/原文件保护、声明产物、外部修改、跨对话引用、目录联接、工作目录变化、移动原文件、清理失败重启恢复及三行进度 |
| 实际 Electron | 开发版及发布包均通过 125%／150% 检查；标题 44px，十次连续工具调用最多三行，减少动态效果生效。真实 Pi 多步工具、系统回收站、失败重试、预览变化、生成中删除、迟到事件、中文输入法、Markdown、长模型名与崩溃恢复均通过 |
| 授权与代理 | 发布包模拟服务回归通过：Pi 回调、长令牌 Windows 加密、重启恢复、令牌刷新、SSE、取消重试、HTTP／解析／存储失败。真实账号沿用已保存的 OpenAI Codex 授权完成模型请求；本轮未重新执行浏览器登录 |
| 真实联网 | 无 Tavily 密钥，发布包使用现有 gpt-6-astra 账号完成 Bing 搜索与 Electron 官方网页正文读取；本轮 Context 为 SDK 返回的 4027 / 272000 tokens |
| 其他模块 | 发布包通过首页、模型目录、Python 判题、学习进度；真实 Pi SDK＋模拟服务完成 8 题面试、113 条学习计划、审批允许／拒绝、取消、限流及后台崩溃。清除应用进程 PATH 中 Node/Python 路径后通过 |
| 发布文件与上游 | 安装包和便携包已生成；便携包全部 CRC 及关键文件 SHA-256 核验通过。本地 pi-main 的 1839 个源文件与固定摘要一致 |
| 覆盖安装及用户数据 | NSIS 覆盖安装成功；安装前后数据库 SHA-256 完全一致，安装文件与发布包一致，桌面快捷方式有效。安装版启动恢复原有 OAuth、gpt-6-astra、5 条对话及 Context，启动前后全部数据库记录不变。真实联网验收新增 1 条标注的测试对话，其余学习数据和设置未变 |

证据：[聊天 125%](evidence/chat-0.1.6-packaged-1.25.json)、[聊天 150%](evidence/chat-0.1.6-packaged-1.5.json)、[授权模拟](evidence/codex-0.1.6-packaged.json)、[真实联网](evidence/live-web-0.1.6-packaged.json)、[模块集成](evidence/integration-0.1.6-packaged.json)、[桌面冒烟](evidence/smoke-0.1.6-packaged.json)、[发布校验](evidence/release-0.1.6.json)、[覆盖安装](evidence/installed-0.1.6.json)、[安装后启动](evidence/installed-startup-0.1.6.json)。

截图：[三行进度](screenshots/progress-0.1.6-1.25.png)、[清理预览](screenshots/delete-preview-0.1.6-1.25.png)、[小窗口 150%](screenshots/chat-small-0.1.6-1.5.png)。

安装后首次截图因隐藏窗口未绘制而超时，验收脚本改为显示非激活窗口后重测通过；应用代码未改变。

发行文件：`release/PiCareer-0.1.6-x64.exe`、`release/PiCareer-0.1.6-x64.zip`、`release/PiCareer-0.1.6-source.zip`；校验清单位于 `release/SHA256SUMS-0.1.6.txt`。

## 边界与复现

- 本轮实际回收测试只使用 `.test-data` 内的合成文件；正常用户的项目产物不会作为测试对象。
- 产物归属以登记和文件核验为依据，未登记、外部修改或被其他对话引用的文件不会自动清理。命令仍以当前用户权限运行，工作目录检查不等同于 PowerShell 沙箱。
- 数据库自动备份仍按既有策略保留；删除对话不是安全擦除或清空备份。回收站文件可由 Windows 恢复。
- 独立干净 Windows 虚拟机不在本机验收范围；公开网站限流、验证及登录限制仍受网站实际行为影响。

```powershell
npm run check
npm test
npm run build
node scripts/chat-check.mjs
$env:PICAREER_SCALE='1.5'
node scripts/chat-check.mjs
node scripts/integration.mjs
node scripts/codex-desktop-check.mjs
node scripts/smoke.mjs
```

设置 `PICAREER_EXE` 为 `release/win-unpacked/PiCareer.exe` 可验证发布包。`live-web-check.mjs --real-account --quick` 会先备份数据，然后使用现有授权完成一次真实搜索和正文读取；`installed-check.mjs` 只读验证已安装应用的数据恢复。
