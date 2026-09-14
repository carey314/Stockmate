# 平台运营部署记录

**最新状态：2026-09-14 Carey 授权后已部署 Web/server 到生产。** 发行代码 `a5d10f376a7c6d680ebe456bae961690cb212995`，完整备份、26旧表值/类型保持、17新表、上传文件校验、公网平台登录及浏览器菜单验收已通过。详见 [RELEASE-20260914.md](RELEASE-20260914.md) 与 `evidence/production-release-20260914.json`。下文保留发布前演练与执行方案；与“未部署”相关的旧时态以本段和发布回执为准。

本批添加独立PlatformAdmin、PlatformAudit、PromoBatch、PromoCode、AiRequestRecord、PlatformEvent六表。已复用原私有生产一致snapshot，完成新目标添加式SQL本地演练；没有重新取生产或在副本启动业务服务。上传文件未纳入。

证据：`evidence/production-platform-rehearsal.json`、`evidence/production-platform-upgrade.sql`。26张旧表旧行/字段/类型保持、17张新增表符合目标schema、完整性与外键检查、Prisma差异为空、本地DDL事务回滚通过。准确SQL/schema/snapshot SHA256均在报告中；先前WebAccessGrant旧目标哈希不代表本目标通过。

## 发布前制定的执行顺序

1. 发布前只读核对生产`/opt/stockmate/server/prisma/prod.db`当刻schema及发行包/SQL/schema哈希。观察快照不是未来状态保证。
2. 若仍是原26表旧基线，唯一匹配路径为本目录完整SQL；若已完整升级至20260914 WebAccessGrant目标，仅应用`server/prisma/migrations/20260914200000_platform_operations/migration.sql`。互斥路径禁止叠加重复应用；其他基线须另生成匹配添加式SQL并演练。禁止生产`db push`；不能未经基线处理直接沿旧`_prisma_migrations`执行`migrate deploy`。
3. 维护窗口停写，使用SQLite一致backup保存当刻库（含WAL一致性）；另备份uploads、当前代码/Prisma客户端、服务环境和nginx配置，核验恢复材料。秘密不入仓库或聊天。
4. 应用选定SQL并核验integrity/FK/schema差异、旧值/汇总与唯一约束。新注册事务依赖PlatformEvent表，必须先升级schema再发布新代码，不能单独热替换auth文件。
5. 安全配置`PLATFORM_JWT_SECRET`（独立高熵、至少32 UTF-8字节、不同于商家JWT_SECRET）及`PROMO_CODE_ENCRYPTION_KEY`（独立32bytes标准base64）。AES key轮换须先迁移旧批次加密材料，不得直接覆盖旧key。缺配置时平台登录/发码503，不能默认放行。AI模型价格未确认则留空，不填伪价格。
6. 使用下述离线CLI建立Carey专用平台账号。店铺User.role=admin不会获得平台权限，不升级现有商家角色。
7. 发布匹配后端/Prisma客户端及Web，Web构建`VITE_BASE=/mate/`、`VITE_API_BASE=https://qxju.shop/mate-api/api/v1`；平台入口`https://qxju.shop/mate/platform`，商家兑换`https://qxju.shop/mate/experience-code`。沿用nginx `/mate-api/` → loopback3100，history fallback按现有Web方式。
8. 授权后在正式环境另核对登录/权限隔离/指标及受控体验码发放，再开放使用。当前本地合成记录不能宣称真实用户增长/付费/真实Apple或短信已验收。

## Carey平台账号安全开通

无公开注册接口。由有主机权限的维护人员运行`server/scripts/platform-admin.js`，显式提供准确DATABASE_URL和平台secret；CLI不自动读取.env。`create --file /私有目录/platform-admin.json`输入`{username,displayName,password}`，`reset-password --file ...`输入`{username,password}`。也可用不回显的安全管道`--stdin`。文件必须当前用户持有、0600普通文件且非symlink，上级0700；密码至少12字符、至多72 UTF-8字节。禁止密码出现在命令行、shell历史、构建变量或仓库。

创建与审计同事务；重复用户名拒绝且不覆盖。重置密码递增平台sessionVersion使旧平台会话失效，禁用账号不会因改密启用。输出只含公开管理员字段。凭据须私下交付，确认接收后按实际凭据管理流程处理输入文件。本次已离线创建 Carey 独立平台账号，凭据只保存在用户本机仓库外私有文件，远端一次性输入已移除。

## 回滚边界

本地通过的是DDL事务提交前ROLLBACK恢复旧schema/旧值，**不是生产服务回退验收**。

- 未提交DDL失败：ROLLBACK，验证旧schema/行/完整性后定位故障，保持停写。
- 已提交但未开放写入：优先保留添加式表并回退已核验兼容的旧代码+Prisma客户端；必须恢复库时先完全停服务，再按维护备份整体恢复WAL状态/权限与对应上传文件。
- 已开放写入：禁止旧库覆盖新单据/兑换/用量；重新停写并备份当刻库，保全发布后差异，优先向前修复。真实数据恢复须具体核对后执行。

仍需独立验收：实际生产服务回退尚未执行；真实店铺领取体验码未代用户操作；运营指标/赠送审计实际留存与公开政策同步；App原生赠送标签/兑换入口由App窗口接入；真实Apple/SMS/真机与App审核口径。线上SMS仍关闭，Apple正式SK2购买缺实际APPLE_APP_ID配置核验。使用指南最后处理。本次未重启本机3100/5180及原有联验服务，原库保持。
