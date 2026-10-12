# PiCareer 0.1.8：手动录入目标岗位

日期：2026-10-11。环境：本机 Windows x64。此版本在企业岗位页面增加手动录入，保留在线检索与已有收藏。

## 实现行为

- 页面标题及收藏区提供新增入口。企业名、地点、名称、职责及要求必填；类型为实习/校招/社招/未注明，默认未注明。学历、经验、毕业年份、薪资、招聘链接和备注选填。前后台校验长度、空内容与 HTTP/HTTPS 链接，职责和要求保留换行。
- 新增草稿在应用运行期间保留；失败不清空。稳定 UUID 与保存期间防重入保证重复点击不会新增两条。保存成功进入收藏。
- 手动岗位标注用户来源、类型和录入时间，避免标成网上已核验岗位。卡片可查看完整详情、编辑、删除及两条 JD 跳转。有链接才显示原文按钮；没有链接不造网址。
- 编辑更新同一记录；删除前确认，重复删除幂等。相关学习与面试记录保留。旧在线收藏继续使用原有收藏操作，不能通过手动接口覆盖或删除。
- 手动 JD 从后台保存的记录生成，包含用户来源、完整职责/要求与选填信息。前端传入的内容不取代后台记录，保存后修改的内容即时用于新 JD。准备阶段不使用模型或网络；正式生成计划/面试沿用现有能力。
- 两条跳转打开新建表单，返回保留收藏视图和滚动位置。弹窗固定标题与底部按钮，中间可滚动，支持 Esc、键盘焦点循环和关闭后焦点恢复。

## 接口与兼容

新增 `saveManualJob`（稳定 ID、create/update 及表单字段）与 `deleteManualJob`（ID）；扩展 `prepareJobJD`，手动来源按 ID 读取本机收藏。`Job` 增加可选的 origin、manual、createdAt 与 updatedAt；未标来源的旧数据仍按在线岗位显示。无来源链接的手动记录 url 为空字符串，各显示/转入入口专门处理。

仍使用 SQLite records/favorite，数据库版本不变，不需要转换旧记录。应用启动保留既有备份机制，不修改 pi-main 或 YxAgent。

## 验证记录

- 类型检查和 83 项自动化测试通过；新增覆盖必填/类型/链接/长度校验、重复保存、同 ID 编辑、创建时间保留、旧收藏保护、删除幂等、计划保留、完整 JD 与重启恢复。
- 开发版 Electron 已验证 125%／150% 缩放：在无模型与断网状态完成保存、编辑、详情、删除及两条 JD 返回；无额外网页请求。模拟数据库写锁使保存失败，输入保留，解除锁后可重试；重复提交不新增重复记录。
- 在线检索回归已通过：严格/相关分组、Bing → DuckDuckGo、字号、取消重试、连续请求隔离、JD 返回及旧收藏保护。
- 发布包同样通过 125%／150% 手动岗位与在线检索验收，包括数据库写锁导致的失败/重试、两次同步提交防重、无模型与断网保存/编辑/JD、完整内容与选填信息、取消编辑、来源链接可选、重启恢复、删除确认与旧收藏保护。JD 使用后台保存内容而非前端传来的篡改字段。
- 发布包集成使用真实 Pi SDK 与本地模拟模型，通过文件审批/PowerShell、模型 API 配置、订阅取消、停止与崩溃、上下文恢复、8 题面试和 113 条学习计划；应用 PATH 不含开发用 Node/Python。桌面冒烟通过内置 Python 判题、学习批次及模型目录。
- 便携包全部 CRC 校验通过，关键文件与 unpacked 一致。固定的 Pi 上游 1,839 个源文件摘要未变。
- 0.1.8 已覆盖安装。安装前后数据库 SHA-256 一致，安装关键文件与发布包一致，原桌面快捷方式有效。安装后启动恢复原有 OAuth、gpt-6-astra、现有对话和 Context；全部收藏、学习及其他数据库记录与启动前一致，新增录入弹窗可正常打开。

证据：[手动岗位 125%](evidence/manual-125-0.1.8-packaged.json)、[手动岗位 150%](evidence/manual-150-0.1.8-packaged.json)、[在线检索 125%](evidence/jobs-125-0.1.8-packaged.json)、[在线检索 150%](evidence/jobs-150-0.1.8-packaged.json)、[模块集成](evidence/integration-0.1.8-packaged.json)、[桌面冒烟](evidence/smoke-0.1.8-packaged.json)、[发布文件](evidence/release-0.1.8.json)、[覆盖安装](evidence/installed-0.1.8.json)、[安装启动](evidence/installed-startup-0.1.8.json)。

截图：[录入表单](screenshots/manual-form-top-0.1.8-1.25.png)、[手动收藏](screenshots/manual-favorite-0.1.8-1.25.png)、[150% 表单](screenshots/manual-form-top-0.1.8-1.5.png)。

本轮不重新进行真实 OpenAI 浏览器登录或真实招聘网页检索；在线搜索引擎与授权流程沿用已验收的 0.1.7，本轮执行模拟服务兼容回归及安装后的已保存凭据恢复检查。

发行文件：`release/PiCareer-0.1.8-x64.exe`、`release/PiCareer-0.1.8-x64.zip`、`release/PiCareer-0.1.8-source.zip`。SHA-256 校验清单：`release/SHA256SUMS-0.1.8.txt`。

## 使用与边界

手动录入表示用户提供的信息，未自动验证企业真伪、岗位是否仍在招聘或来源可信度。来源链接是可选备注，不会在保存或 JD 准备时自动访问。选填信息按用户填写保留，不推测学历、薪资或毕业年份。

新增草稿仅在本次 App 运行期间保留，保存的收藏重启可恢复。取消编辑不会修改已保存记录。编辑或删除不会回写此前已生成的学习计划与面试快照。本轮不增加 Excel/文件导入、批量录入或自动投递。

```powershell
npm run check
npm test
npm run build
node scripts/manual-jobs-check.mjs
$env:PICAREER_SCALE='1.5'
node scripts/manual-jobs-check.mjs
node scripts/jobs-check.mjs
```

设置 `PICAREER_EXE` 指向发布包中 PiCareer.exe 可验收打包版本。所有新建/编辑/删除测试在独立测试目录进行，不改正常用户收藏。
