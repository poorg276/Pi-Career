# PiCareer Git 与发布维护

## 首次基线

仓库只包含 PiCareer，分支为 `main`，应用版本仍为0.1.13。首个提交为 `chore: establish PiCareer 0.1.13 baseline`，附注标签为 `v0.1.13`。标签代表当前已交付应用的首次Git基线及新增维护规则；没有重建此前版本的提交，也没有重写已有安装包、便携包或源码快照。

源代码、测试、维护脚本、内容、依赖锁文件、文档、图标及SDK来源摘要纳入Git。依赖、生成的SDK、构建产物、发布包、归档、数据库、会话、个人材料、环境密钥与日志不纳入。运行截图可能显示真实用户状态，整个 `docs/screenshots` 留在本地，不纳入Git；验收文字和不含私人材料的结构化报告保留。原始SDK `pi-main` 与 `YxAgent` 是同级独立目录，不属于本仓库；构建仍按README从本地SDK副本获取依赖。

Git历史管理同一份源码的修改，不再用多套核心文件保存版本。仓库目前仅在本机，没有远程仓库，没有推送；本地Git不是异地备份。

首次暂存检查发现原有依赖清单、升级脚本的文件末尾空行，以及第三方许可证汇总的空白告警。这些既有字节按当前基线保留，没有为了初始化Git格式化旧代码或改写第三方许可；新增维护文件的空白检查通过。

## 每次功能或修复

完成一个独立变更后，运行与变更相关的类型检查、自动化及必要的Electron验收，检查待提交文件并提交。不要提交真实密钥、个人材料或数据库，也不要把没有运行的检查写为通过。

```powershell
git status --short
git diff
npm run check
# 按修改范围运行测试；不必每次重新打包。
node --test --test-isolation=none tests/archive-releases.test.ts
git add <明确的文件路径>
git diff --cached --stat
git diff --cached
git commit -m "fix: 简明描述修复内容" -m "Validation: 实际完成的检查及结果"
```

执行实际Electron测试期间不要同时运行会重写SDK副本的构建或 `npm test` 前置准备。发布或重大修改应按对应验收记录完成回归。未经明确要求不改变全局Git身份或推送到外部服务。

## 每次发布

1. 修改版本和实现，完成对应验收，记录发布包SHA256与结果。创建源码包时包含维护规则，不包含Git内部目录、用户资料、运行截图或依赖。
2. 提交最终实现与验收文档，确认工作区状态。对该提交创建附注标签 `v<版本>`，在标签说明中记录验证结果及三个交付包的SHA256。已有标签不可强制覆盖。
3. 显式登记这次已验收发布，并预览归档；确认后执行。普通候选包即使文件齐全，也不会自动被当成已验收版本。

```powershell
git log -1 --oneline
git status --short
git tag -a v0.1.14 -m "PiCareer 0.1.14: 发布说明、实际验收和交付包SHA256"
node scripts/archive-releases.mjs --accept-version 0.1.14
node scripts/archive-releases.mjs --accept-version 0.1.14 --apply
```

以上0.1.14仅为未来发布示例，并未创建这个标签。登记要求安装包、便携包、源码包及三者的有效校验记录均存在，还要求对应标签为附注标签。已登记版本不允许更改原摘要。登记是发布负责人确认验收完成的操作，脚本不能代替真实功能验收。

## 本地发布包与恢复

`release` 保留最近两个已登记完整版本和当前 `win-unpacked`。旧包及对应blockmap、版本说明、校验文件位于 `archive/releases/<版本>`，无版本号的旧说明和混合校验清单位于 `archive/releases/legacy`。归档仅整理路径，所有字节保留，不释放同磁盘空间。

首次登记使用 `node scripts/archive-releases.mjs --register-existing` 预览，再加 `--apply` 执行。它只登记不晚于当前应用版本的既有完整发布；此引导操作只能在没有目录登记表时使用。之后普通检查为：

```powershell
node scripts/archive-releases.mjs
node scripts/archive-releases.mjs --apply
```

归档目录包含 `catalog.json` 发布登记和 `manifests/archive-*.json` 逐文件移动记录，记录源路径、目标路径、大小、SHA256和结果。每个目标在移动前检查，没有覆盖操作；同名冲突或摘要变化会停止，保留文件。路径逃逸、符号链接及Windows目录联接会被拒绝。

同磁盘通过排他的硬链接创建归档入口，核对两端摘要后才移除旧目录入口；不递归删除目录，不压缩或改变文件内容。该操作需要支持硬链接的文件系统；不支持时会报错而不是降级为不安全移动。中断后不编辑登记表或移动清单，先运行普通预览检查，再执行 `--apply`，恢复未完成清单并再次核对文件。若文件被外部改动或目标不同，排查冲突后再试，不强行覆盖。

归档与Git目录都应随本地项目备份保留。此前ZIP是历史源码快照，不会伪装成旧Git提交。清空归档、清理缓存或删除用户数据需要另外明确的请求。

## 本次执行记录

见 `evidence/maintenance-baseline.json` 的检查结果、发布包摘要和归档清单位置。通过 `git log -1`、`git show v0.1.13` 查看首个提交及标签，不在提交内嵌入其自身SHA。此次未升级或重新安装应用，原快捷方式、用户记录与当前启动目录保留。
