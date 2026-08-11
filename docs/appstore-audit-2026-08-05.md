# App Store 上架预审报告（2026-08-05）

> 结论：**现在提交 = 必拒**。4 个必拒项、6 个高风险项，但没有一个伤筋动骨——全是收尾工程和行政流程。
> 功能主体（完整闭环的工具类 app）够上架资格。关键路径是 **App 备案（1~3 周）**，代码侧 2~3 天能齐。
> 所有 ✅/🔴 均来自 2026-08-05 真实取证（grep 代码 / release 真编译 / 线上 curl），非猜测。

## 🔴 必拒项（不解决 100% 被拒）

| # | 问题 | 证据 | 审核条款 | 修法 |
|---|---|---|---|---|
| 1 | **后端在开发机 localhost**，审核员真机连不上，app 全功能瘫痪 | `api.dart:7` 默认值 `http://localhost:3100` | 2.1 App Completeness | 部署后端到腾讯云 122.51.1.28（HTTPS 已现成），打包时 `--dart-define=API_BASE=https://qxju.shop/mate-api/api/v1` |
| 2 | **无删除账号功能**。有注册就必须能在 app 内删号（2022 起强制） | 全仓 grep「删除账号/deleteAccount」零命中 | 5.1.1(v) | 后端删号接口（级联清数据）+ App 设置页入口 + 二次确认 |
| 3 | **中国区 App 备案缺失**。注意：≠ 网站 ICP 备案（qxju.shop 的网站备案 2026-03 已提交，但 App 备案是独立流程，要绑定 bundle id `com.carey.stockmate`） | server_info + 备案系统无 APP 记录 | 中国区提交表单硬字段 | 腾讯云备案控制台追加"APP 备案"，周期 1~3 周——**最长链路，最先启动** |
| 4 | **ATS 全开明文** `NSAllowsArbitraryLoads=true`（开发期为连 localhost 开的） | Info.plist:43 | 2.5.x + 提交时须书面解释 | 后端上 HTTPS 后整段删除 NSAppTransportSecurity（NSAllowsLocalNetworking 也可一并删） |

## 🟡 高风险 / 提交材料缺口

| # | 问题 | 说明 |
|---|---|---|
| 5 | **PrivacyInfo.xcprivacy 缺失**（2024 起新提交强制） | 声明 UserDefaults 等 required-reason API；主流 Flutter 插件自带，但主 app 的要自己加 |
| 6 | **ITSAppUsesNonExemptEncryption 未声明** | 不拒审，但每次提交要手动答加密问卷；标准 HTTPS 填 `false` 一劳永逸 |
| 7 | **iPad 支持开着**（TARGETED_DEVICE_FAMILY="1,2"）但 UI 从未在 iPad 上验证 | 审核员会用 iPad 测；布局崩了就是 2.1。建议改成 `1`（iPhone only）省事 |
| 8 | **隐私政策 URL + 技术支持 URL** | App Store Connect 必填两个真实网页。可挂 qxju.shop 下静态页。**必须写明：语音转文字、经营数据上传服务器、文本内容发送 DeepSeek（第三方 AI）处理** |
| 9 | **App 隐私标签问卷** | 如实申报收集：账号信息（用户名/Apple ID）、用户内容（商品/客户/订单数据）、语音输入。均"与用户关联" |
| 10 | **审核演示账号** | Connect 里填 demo 账号 + 密码；建 review 专用账号并预置种子数据（空账号审核员看不出功能，也别把 admin 生产号给出去） |

## 🟢 已达标（本轮真验证）

- **Sign in with Apple 三件全真**（4.8 过）：UI 只渲染 Apple 按钮（华为/微信只是注释+后端诚实 501，没有假按钮）；后端 JWKS 真验签（appleAuth.js）；entitlement 已配
- **权限文案 5 项齐全且具体**：蓝牙/相机/麦克风/语音识别/相册（Info.plist:29-38）
- **图标全套 19 个**（含 1024 marketing）
- **release 真编译通过**：`flutter build ios --release --no-codesign` → Runner.app 21.9MB（有 Swift Package Manager 迁移警告，目前不挡道）
- **服务器 HTTPS 健康**：qxju.shop 200，证书 certbot 自动续期正常（当前有效期至 2026-10-14）
- **登录墙合法**：账号制工具 app 允许强制登录（5.1.1 不要求游客模式）
- **无 IAP**：免费 app，无 3.1 系列问题；将来 AI 计费必须走苹果 IAP（任务 #13 注意）
- **kDebugMode 自动登录 release 自动失效**；测试数据有 purge 脚本

## 行动路线（按依赖排序）

1. 【今天启动·等 1~3 周】腾讯云备案控制台提交 **App 备案**（主体已有网站备案，追加 APP 类型 + bundle id）
2. 【1 天】部署 StockMate 后端上服务器：`/opt/stockmate/server`（SQLite 直接跑）+ nginx 加 `/mate-api` 反代 3100 + PM2
3. 【半天】删除账号闭环：后端接口（软删用户 + 数据不可恢复说明）→ App 我的页入口 → 双重确认
4. 【1 小时】Info.plist：删 ATS 段、加 `ITSAppUsesNonExemptEncryption=false`、device family 改 `1`；新增 PrivacyInfo.xcprivacy
5. 【半天】隐私政策 + 技术支持两张静态页挂 qxju.shop（写明 DeepSeek 第三方处理）
6. 【材料日】Apple Developer 账号（个人 $99/年）→ Connect 建 App（名称"智存-AI进销存"）→ 6.7" 截图 → 隐私标签 → demo 账号 → 提交

预期：代码侧 2~3 天，行政（备案+开发者账号审核）1~3 周 → **约 3~4 周后具备可提交状态**。
