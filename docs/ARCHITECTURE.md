# 架构与维护

## 进程与数据流

React/Vite 渲染进程 → 类型化 preload Bridge → Electron 主进程 → utilityProcess 中的 Service → Pi SDK / SQLite / Tavily。

主进程承担窗口、目录选择、系统浏览器、Windows 加密、消息路由及独立 session 的公开网页网络请求。后台承载模型凭据适配、Pi Session、业务状态、来源解析和服务适配。前端仅获得凭据是否存在；没有读取密钥的 IPC 方法。

算法练习另外使用 `practice://runner` 跨源 iframe 和 Worker。该源没有 preload，无 Node 集成；WebAssembly Python 只能访问独立虚拟文件系统。运行时和标准库均来自安装包。每轮独立环境、超时直接销毁 Worker，可重新运行。

## 核心文件

| 文件 | 职责 |
|---|---|
| `src/shared/types.ts` | IPC、业务状态、事件类型 |
| `src/core/pi.ts` | `createAgentSession`、`ModelRuntime`、`SessionManager`、CredentialStore、授权、工具审批 |
| `src/core/service.ts` | 业务 API、参数约束、并发互斥和跨模块编排 |
| `src/core/store.ts` | SQLite 数据持久化 |
| `src/core/search.ts` | Tavily 搜索/正文抽取、来源清洗和岗位检索 |
| `src/core/study.ts` | 学习计划快照、幂等批次、50 条测验、结业测验 |
| `content/judge.py` | 函数、原地修改、链表、树、图、设计类判题适配器 |
| `content/*.json` | 版本化知识与算法数据 |
| `src/ui/main.tsx` / `style.css` | 中文界面与设计系统 |
| `scripts/build.mjs` | 打包本地 Pi 构建产物及其依赖，生成源码摘要 |

SQLite records 表以 kind/id 为主键存 JSON；计划快照存入完整知识条目而不是可漂移的索引。批次完成令牌每次推进时更换，测验 ID 防止重复提交。外部服务失败不会伪造搜索结果。默认全局聊天互斥，面试/测验按记录互斥。

## 边界与后续维护

- 外部网页内容只作为文本交给无本机工具的求职会话。聊天启用本机工具需选目录，写文件和命令需审批。
- UI 禁止远端网络加载，CSP 和导航限制集中在 Electron 主进程；联网仅通过后台服务与主进程独立网络 session 执行。
- PowerShell 授权属于显式本机执行权限，不代表沙箱。路径保护主要针对 Pi 文件工具。
- 自定义兼容模型使用 64k 上下文、8k 最大输出的默认描述；接入能力不同的服务时应调整适配器，不能从模型名称推测真实限制。
- 供应商和订阅模型目录是固定快照，未来变化需重新核验目录和实际授权能力。
- 安装包自带 `@vscode/ripgrep-win32-x64@1.18.0`。Pi grep 使用本地工具目录；find 通过 Pi 官方扩展接口复用该二进制的 glob 列表能力，不依赖用户安装 fd。后台 Pi 配置目录独立放在本应用 userData 下。
- 现有数据库版本为 1。将来修改数据结构前，应实现版本化迁移并保留完整备份。
- 题目更新执行 `python scripts/make_problems.py` 后同时跑原生 Python 和 WebAssembly 参考解验证。新增适配器还需错误解、边界与运行隔离测试。
- 知识更新执行 `python scripts/make_knowledge.py`；保留稳定 ID，变更内容时递增版本。已建立的计划不会自动替换条目。
- 首版不含云同步、语音、自动投递、力扣账号提交或完整 Pi 扩展管理。

## 依据与许可

- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)
- [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Pyodide Worker](https://pyodide.org/en/stable/usage/webworker.html)
- [力扣热题 100](https://leetcode.cn/studyplan/top-100-liked/)

Pi 上游 MIT 许可证随发行包保留在 `resources/PI-LICENSE.txt`。第三方组件许可汇总在 `resources/THIRD-PARTY-NOTICES.txt`，后台依赖保留各包原有 LICENSE。题目概述和知识解释为本项目整理，原题正文及平台服务归各自权利人所有。

## 0.1.4 通用 Agent

`Chats` 单独管理标题、目录、revision 与兼容旧消息的 entries；后台每轮有 turnId，工具记录有 toolCallId。开始即保存用户输入，文字流最多每 150ms 落盘与推送，工具结束和轮次结束立即保存。流式保存合并最新标题元数据，避免覆盖并发重命名。意外退出的 running 记录启动时转为 interrupted，不重放命令。

前端应用级消费 chatUpdate，全量快照按 revision 合并，页面卸载不丢流式状态；普通业务 busy 与聊天运行状态分开。stopChat 只中止指定聊天。继续旧 Pi 会话时通过 cwdOverride 使用当前工作目录。

通用会话显式注册并启用日期、天气、Tavily 搜索和抽取工具；项目会话增加 Pi 文件工具与 PowerShell。内存 SettingsManager 避免自动加载第三方可执行扩展；通过显式资源目录和加载覆盖器接入项目说明与 Skills。无目录会话使用独立 workspace 路径且不开本机文件工具，避免将用户数据目录当作可读项目。求职工具配置保持独立。

service-network 仅处理 Tavily 与 Open-Meteo 三个固定域名，和 Codex 共用主进程系统代理解析通道，不改变其他供应商的网络行为。所有工具接受当前执行取消信号，网页内容与工具结果不能改变授权边界。

## 0.1.5 搜索、删除与轮次完成

`Search` 优先可选 Tavily，再尝试 Bing、DuckDuckGo HTML。工具协议不变，`Source` 增加实际引擎与备用原因。linkedom 只解析 DOM、不执行网页脚本；Readability 提取正文。相关性基础检查拒绝完全无查询词重叠的结果页，避免把无关页面当作成功检索。

`webRead / webReply / webCancel` 仅在 utilityProcess 与主进程之间传递。`PublicWeb` 每种系统代理路由使用独立的非持久 session，明确固定代理或 DIRECT；不使用禁止联网的 UI session，也不携带 UI Cookie 或模型凭据。公开地址、DNS 与最多 5 次重定向均校验；20 秒超时，2 MiB 正文上限，25,000 个 DOM 节点上限。网页限流、验证、连接和解析错误保留区别。模型授权、刷新及 SSE 继续使用 0.1.3 网络适配器。

`deleteChat` 先写入持久删除标记，再等待该聊天停止与 finally 完成，随后清理受控 sessions 目录内的独占 JSONL 和业务记录。迟到保存不得恢复记录；启动时继续未完成清理。`chatDeleted` 在前端维护删除集合，过滤迟到事件、请求结果与快照。删除标记只保留 ID 与清理状态，完成后不保留聊天正文。

`Chat.turns` 按 turnId 保存终态、实际模型、结束时间与 Pi `getContextUsage()`。统计在 dispose 前获取；前端每轮只显示一次结束行。自定义模型的默认 64k 运行描述不被宣称为已确认容量，因此不展示其百分比。数据以可选字段扩展，保留旧记录和 SQLite version 1；升级前备份。
