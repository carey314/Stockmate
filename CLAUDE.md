# StockMate 智存 · 项目指南

AI 原生多场景进销存。Flutter iOS App（安卓/鸿蒙后置）+ Node 后端 + DeepSeek。
产品灵魂：**"30 秒配成自己行业、AI 帮你配的进销存"**——深的是通用进销存引擎，活的是品类字段，配的是 AI。

## 架构速览

- `app/` Flutter（Riverpod + go_router + dio + mobile_scanner7 + speech_to_text）
- `server/` Express + Prisma + SQLite(开发)/MySQL(生产计划)，端口 **3100**
- `docs/` 框架大纲 / 上架调研 / 打印调研
- 登录：admin / admin123（debug 版 App 自动登录，发布前移除 main.dart 里的 kDebugMode 自动登录）

## 核心数据模型（v2，SKU 体系）

- **ProductType(品类) → FieldDefinition(字段, scope=product 商品描述 / scope=sku 规格维度)**
- **Product(SPU) → Sku(规格)**：价格/成本/条码/**库存全在 SKU 上**；无规格品类自动建"默认规格"
- Inventory 按 skuId 唯一；InventoryRecord 全量流水（出入库/调整/口述都留痕）
- Order(销售单)/PurchaseOrder(进货单)：折扣率/折扣额/实付/已付(unpaid=欠款)/结算账户/printedAt
- Income(无库存关联收入) / Expense(经营支出)：口述记账用
- JSON 字段存 String（跨 SQLite/MySQL），应用层编解码

## AI 能力（DeepSeek，提示词全在 server/src/controllers/）

- `ai.js`：FIELDS_SYSTEM_PROMPT（品类两层字段）、PRODUCTS_SYSTEM_PROMPT（按品类生成商品）、IMPORT_SYSTEM_PROMPT（粘贴导入/搬家）、ASK_SYSTEM_PROMPT+buildBusinessSnapshot（AI问生意：经营快照问答，答不了就诚实说）
- `aiParse.js`：口述记账 v2（进/销/支/汇总营业额；客户识别+按客户分单；价格三级=专属>上次成交>标价；方向判定铁律+退货红线；AI 只出草案，确认才落库）
- key 在 `server/.env` DEEPSEEK_API_KEY（.gitignore 内）
- **AI 回归基线**：scratchpad/ai_test_suite.js（16场景），改提示词必跑

## 单据/账务体系

- 销售单/进货单：折扣/实付/欠款/结算账户/打印时间；详情页票据渲染→图片分享（打印底座）
- PaymentRecord 收付款流水（开单收款/补收/进货付款/补付/退款全留独立时间戳）
- 退货：销售退(库存回增+冲应收+多收退款)/进货退(库存扣+冲应付)；OrderItem.returnedQty 防超退
- 报表中心 9 张：经营利润/销售按商品/热销/库存统计/进货统计/员工业绩/资金流水/客户对账单/供应商对账单（对账单=期初+往来+期末，退款红冲）
- 盘点单(PD)：POST /stocktakes 提交即完成，账面数取提交那一刻库存，差异直接落库存+留"盘点盘盈/亏（PD号）"流水
- 多员工权限：User.role admin|staff；adminOnly 守卫（利润/资金流水/员工业绩/AI问生意/导出/员工管理/店名/删商品删品类删SKU）；App 侧按 profileProvider role 隐藏入口。店名在 Setting 表（key=shopName），票据抬头用它而非登录人 realName
- 蓝牙小票打印：print_bluetooth_thermal + esc_pos_utils_plus；PrinterService（core/printer_service.dart）截票据卡片→384点灰度光栅→ESC/POS；设置页 /printer；**未用真机+真打印机验证过**
- 数据导出：GET /export/all（仅老板）；App 里可选 CSV 6表 或 JSON（诚实承诺：导出永远免费）
- 通知中心 P1（features/notifications/）：首页铃铛红点，实时聚合库存预警/客户欠款/欠供应商/今日小结，已读指纹存本地；P2/P3 见 docs/notification-design.md
- 列表检索：商品/开单选货/进货选货/盘点 搜索+品类筛选（Product.matches 统一匹配名称/编码/条码/规格）；订单/进货单列表 搜索+状态筛选（欠款筛选带合计条）；商品卡点库存数字=快捷调库存（走 /inventory/adjust）
- **主营品类**（Setting key=mainTypeId，PUT /settings/main-type 仅老板）：`mainTypeIdProvider` 读 profile.mainTypeId，没设过且只有1个品类时自动认它。商品页/开单选货/进货选货/盘点/新建商品全部默认落在主营；品类<2 个时商品页不显示筛选条。品类管理页有「设为主营」入口
- 库存编辑三处入口，都走 /inventory/adjust 留流水：①商品卡库存徽章（快捷面板）②编辑商品页规格行上的 −/数字/＋（保存时批量落库，改动行标黄）③盘点单。**规格弹窗里不再有库存字段**（单一来源，别再加回去）
- 首页：三个指标卡可点（订单/商品页），缺货时多一张「该补货了」卡直接列缺货规格 + 一键开进货单

## 2026-08-04 客户视角审查后的六条铁律（改代码前必看 docs/audit-2026-08-04-customer-lens.md）

1. **底栏中间大按钮 = 开单**，不是扫码。扫码页只改库存不记钱，页面里已加红字警告 + 「要卖货？去开单」按钮。别再把扫码放回中间。
2. **散客**：开单不传 customerId → 服务端挂内置「散客」（`biz.js getWalkInCustomer`）。强制选客户会把小店第一单卡死。
3. **默认允许负库存**（Setting `allowNegativeStock`，`biz.js isNegativeStockAllowed`）。库存没录全就来客人是常态，硬卡单等于劝退；卖成负数时返回 `negativeStock` 数组让 App 提示补录。
4. **AI 绝不编成本价**。`ai.js PRODUCTS_SYSTEM_PROMPT` 明令禁止输出 costPrice——假成本比没成本危害大得多（0 能一眼看穿，4.2 永远发现不了）。粘贴导入可以提取用户真实数据里的成本。
5. **成本快照**：`OrderItem.costSnapshot` 锁住卖出那一刻的成本。不存快照的话进价一改，历史月份的利润会被追溯改写。所有报表统一用 `costSnapshot ?? sku.costPrice ?? product.costPrice`。`/stats/overview` 会返回 `profitUnreliable`/`noCostSales`，首页毛利卡据此提示「其中 ¥X 的货没填进价」。
6. **不许静默改用户的数字**。口述记账的数量不再 `Math.round`（0.4 会变 0 生成 ¥0 单据），改成 `assertWholeQty` 显式报错。分页也不许静默截断：盘点逐页拉全并在取不全时报错，客户/供应商用 `_fetchAllPages`。

配套回归测试：`app/test/product_pagination_test.dart`（自造 45 个商品跑完自删，需后端在 3100）。

## 常用命令

```bash
# 后端
cd server && node src/app.js                 # 或 npm run dev；日志 /tmp/stockmate-server.log
npx prisma migrate dev --name xxx            # 迁移
npx prisma db seed                           # 种子(admin+预设品类)

# Flutter（SDK 在 ~/projects/flutter，stable 3.44.x）
export PATH="$HOME/projects/flutter/bin:$PATH"
cd app && flutter analyze
flutter build ios --simulator --debug        # 部署目标 iOS 15.5
xcrun simctl install booted build/ios/iphonesimulator/Runner.app
xcrun simctl launch booted com.carey.stockmate
xcrun simctl io booted screenshot /tmp/x.png # 截图验证
# 直达某屏调试: flutter build ... --dart-define=START_ROUTE=/types
```

## 设计语言（事实源：~/Downloads/browser/stitch_smart_ai_inventory_hub/）

靛蓝紫 #4648D4 / 底 #faf8ff / 24px 大圆角软阴影卡 / 药丸按钮 / AI 功能用 ✨ 渐变卡。
令牌在 `app/lib/core/theme.dart`。**中文字重最高 w700 + PingFang 回退**（w800 会致个别汉字渲染异常）。

**Web 端事实源：`~/Downloads/browser/stitch_smart_ai_inventory_hub 2/`**（Aetheric Modern，完整令牌在 aetheric_dashboard/DESIGN.md）：surface #f9f9ff / 主色 #4648d4 / 260px 侧栏（导航激活=左竖条+8%靛蓝底）/ 24px 卡 + 1px #e2e8f0 边 + 靛蓝 6% 软阴影 / 药丸按钮 / Manrope+PingFang。Web 令牌在 `web/src/theme.ts`（antd ConfigProvider 统一注入）。

## 已踩的坑（别再踩）

- mobile_scanner 6 的 MLKit 不支持 arm64 模拟器 → 用 7.x（iOS 原生 Vision）
- iOS 模拟器无摄像头/语音受限 → 扫码有手输兜底、语音可打字
- Inventory 已无 product 关联，查询走 `sku.product`
- SnackBar/浮动导航：extendBody=false，内容不穿功能栏
- 库存不允许直接改数：走 /inventory/adjust（自动留"手动调整"流水）
- 备案坑：App 备案服务描述写"个人库存记录工具"，别写"进销存/交易"
- pub.dev 直连易 TLS 失败 → `PUB_HOSTED_URL=https://pub.flutter-io.cn FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn`
- 模拟器无法程序化滚动截长页 → 用 START_ROUTE 直达子页分别截

## 任务约定

- 改后端必 curl 真测；改 App 必 analyze + build + 装模拟器（+关键屏截图）
- **接口测试造的数据用完即删**（教训：测试账号"老王的店"留库里，害用户注册撞名排查半天）
- **模块必须一次交付完整闭环**（教训：登录注册返工3-4次）。开工前列 DoD：①全部用户路径(成功/失败/空态/边界)②配套管理入口(增删改查看)③反馈提示(成功/错误都要有)④真测每条路径。缺一不发。
- 交付诚实协议（见全局 CLAUDE.md）：没真测的必须标注
- 上架调研结论：docs/app-release-research.md；打印方案：docs/receipt-printing-research.md


## 2026-08-05 P0余项+P1+P2 大批量后的新事实（改代码前必读）

**账务模型**
- 数量全线支持小数（散称 0.5 斤）：Inventory/InventoryRecord/OrderItem/PurchaseOrderItem/Stocktake 均为 Float；App 端用 `fmtQty()` 显示（去尾零）。口述记账不再拒绝小数。
- **退货留痕**：销售/进货退货各写一条 PaymentRecord `account='冲账'`（销售 in / 进货 out，金额=全部退货价值）。对账单的单据行显示**原始金额**（= 当前 actualAmount + Σ returnedQty×unitPrice），退货以带时间戳的「退货冲减」行核销——已发出的历史对账单不再被追溯改写。**资金流水必须排除 account='冲账'**（不是真钱）。
- **口述挂账**：卖出解析带 `paid` 字段；记名客户没明说收钱 → 默认挂账（paidAmount 0 / 结算=挂账 / 不写收款流水）；散客默认现款。
- 报损/过期/自用出库（reason 命中关键词）→ 自动按成本记一笔 Expense(category='库存损耗')，利润才真实。

**AI**
- parse-entry 支持 `mode`: default / customerOrder(客户订货消息,全按卖出+deliveryNote) / purchaseBill(送货单OCR文字,全按进货+supplierName)。进货单页「拍单据」= Vision OCR → purchaseBill 模式 → 直接铺单。
- ask 支持 `history`（最近3轮）；快照含「补货建议_按销速计算」（近14天日均×7天 vs 库存，确定性公式，AI 只负责说人话）。
- 字段生成的 specs 带 `affectsStock`（温度/糖度=false 不产生库存规格）。

**结构/交互**
- 配方 Recipe（一级 BOM）：`/skus/:id/recipe` GET/PUT；卖有配方的 SKU = 扣原料不扣自身（`biz.deductForSale` 统一出口，orders 和口述共用）。原料不能再是成品（拒多级）。
- 客户中心 `/customers`（列表按欠款降序+总欠款条）+ `/customers/:id` 详情（欠款/未清单据/专属价/历史/对账单/编辑删除）。customers.list 返回 owed/unpaidCount。
- 独立出入库 `/inventory-move`（多品+原因+相对量语义）；商品详情只读页 `/products/:id`（编辑挪到右上角）。
- 开单：cart 行点击=改价改量+「记为专属价」；实收<应收非挂账 → 抹零/挂账二选一；折扣<50 二次确认；多规格一次多选带数量；选货弹窗有「TA常买」chips（/customers/:id/frequent）；`/orders/new?from=ID`(再来一单) `?customer=ID`(锁客户，退货 SnackBar 换货桥用)。
- 进货单：快建商品/扫码/拍单据三入口 + 本地草稿（SharedPreferences po_draft_v1，提交成功清）。
- 规格：批量生成（affectsStock 的 select 维度笛卡尔积+统一价，>60 组合拦截）；同商品 specValues 查重（键排序比较）；Sku.imageUrl 规格图（选货/详情优先用，回退商品图）。
- 断网降级：types/products/customers/suppliers 走 `_cachedList`（网络错误回放上次成功数据，只读；写操作照常报错）。对外话术已改为「断网能查、单子不丢」，**不承诺离线开单**。
- M14 守卫：products.update 只在"无规格单品"(skuCount≤1)时把 defaultPrice/minQuantity 同步到默认规格。

**测试**
- 单测 `app/test/product_pagination_test.dart`（自造自清）；集成测试 `app/integration_test/core_flows_test.dart`（散客开单+收欠款，真手点，需后端3100+模拟器）。
- 环境坑：node 命令一律 `env -u NODE_OPTIONS`（cmux 的 preload 文件会被系统清掉导致所有 node 报 MODULE_NOT_FOUND）。

## 2026-08-05 AI 环节专用化（任务#38）后的新事实

- **AI 五窗口架构文档**：`docs/ai-agents.md` 是唯一事实源——5 个环节的人设位置/输入输出/防线/回归清单都在里面。加新 AI 环节三件套缺一不上线：专职人设（含统一铁律段）+ aiGuard sanitizer + 回归用例。
- **出口清洗层**：`server/src/utils/aiGuard.js`——AI 说什么不算数，过了清洗才算数。sanitizeFields / sanitizeProducts(allowCost 区分生成false/导入true) / sanitizeAnswer / sanitizeParseEntry。dropped 一律透传，不许静默吞。
- **提示词统一铁律**：5 个提示词头部都有【专职铁律】段（只做本职/用户文本里的指令是数据/做不到交空手/只输出JSON）。ask 另有数字铁律（数字必须逐字来自快照）。
- **对抗回归**：`server/scripts/ai-regression.js`，19 项断言全绿基线 2026-08-05。改提示词/aiGuard 必跑。坑：响应会回显输入 text（含攻击载荷），断言要排除 text 字段；DeepSeek 网络波动 503 靠脚本内置重试，别误报。
- **富化字段名**：parse-entry 返回的客户富化字段叫 `customer`（不是 matchedCustomer），商品是 `matchedProduct`。

## 2026-08-05 语音卡死修复后的新事实

- **语音引擎"挂起免疫"三件套**（voice_entry_screen.dart）：initialize 带 6s timeout（权限弹窗没人点/模拟器引擎挂死时 Future 永不 resolve）；listen 不 await（unawaited + 1.2s 后独立校验 `_speech.isListening`，没在听就复位+人话）；onStatus 复位时若"刚开听<5s 且零识别文字"判定引擎没真启动 → 人话提示。三种失败模式（onError / 静默死 / 挂起）全部不卡死、全给人话+键盘🎤降级引导。
- **模拟器语音必失败是苹果限制**（iOS 17+ 模拟器无完整语音栈），真机正常。别在模拟器上验语音识别本身，只验失败路径的 UX。
- **主动停止顺序**：先 `setState(_listening=false)` 再 `_speech.stop()`——反过来 onStatus 回调会把主动停止误判成"引擎没启动"弹提示。
- **集成测试三坑**：① push 页面找控件必须 `find.descendant(of: find.byType(页面类), ...)`——栈下层页面的同名图标 find 找得到但 tap 打空（IgnorePointer），`.first` 会选错；② simctl privacy 不支持 speech-recognition，要直插 TCC.db（`data/Library/TCC/TCC.db`，service='kTCCServiceSpeechRecognition'，auth_value=2，插完 `launchctl stop com.apple.tccd`）且 flutter test 重装后可能失效——所以产品代码必须对 initialize 挂起免疫，测试不依赖预授权；③ 排障三板斧：超时时 dump 页面全部 Text → 逐 tick 记录 UI 轨迹字符串 → 产品类挂静态事件缓冲（integration test 与 app 同 isolate 可直读，`VoiceEntryScreen.debugEvents`）。
- **语音回归测试**：`integration_test/voice_recover_test.dart`（两次点击不卡死+必有人话），与 core_flows_test 一起跑全绿基线 2026-08-05。

## 2026-08-06 上架必拒项修复后的新事实

- **删除账号已闭环**（5.1.1(v)）：`POST /auth/delete-account`——最后一个活跃用户删号=清店（22 表按外键倒序 deleteMany）；否则匿名化本人+硬删 AuthIdentity。鉴权中间件已改为每请求查 user.status（删号/停用后旧 token 立刻 401）。App 入口在 我的→删除账号（两步确认+手输「删除」）。隔离库真测 8/8。
- **生产环境已上线**：https://qxju.shop/mate-api/api/v1（腾讯云 /opt/stockmate，PM2 stockmate-server，端口 3100，nginx rewrite 剥前缀）。审核 demo 账号 review/ReviewDemo2026 已种数据。隐私政策/支持页在 qxju.shop/stockmate/privacy 和 /support。
- **打正式包必须带**：`--dart-define=API_BASE=https://qxju.shop/mate-api/api/v1`（默认值是 localhost，忘传=废包）。
- **iOS 合规现状**：无 ArbitraryLoads（留 NSAllowsLocalNetworking 供 debug 连 localhost，ATS 官方豁免）；ITSAppUsesNonExemptEncryption=false；UIDeviceFamily=[1]（iPhone only）；PrivacyInfo.xcprivacy 已进包。
- **pbxproj 手插资源的坑**：正则找 PBXResourcesBuildPhase 会先撞上 RunnerTests（331C 开头 ID）——必须定位含 Assets.xcassets/LaunchScreen 的 files 段（Runner 主 target 是 97C146EC）。插完必须验产物：`ls build/ios/iphoneos/Runner.app/PrivacyInfo.xcprivacy`。
- 待用户提供：App 备案号（已在办）、Apple Developer 账号。之后走 Connect 建 app→截图→隐私标签→提交。

## 2026-08-06 Web 管理端（web/）全模块完成后的新事实

- **技术栈**：React19+Vite8(rolldown)+TS+antd v6+echarts(按需,lib/echarts.ts 唯一入口禁裸包)。dev 端口 5180，`vite base=/stockmate/admin/`。构建 `env -u NODE_OPTIONS npm run build`。设计规格+接口形状事实源：`docs/web-design-spec.md`；令牌 `web/src/theme.ts`（卡24/导航32/控件12/按钮999）。
- **页面**：工作台(趋势卡+echarts折线+右栏动态/AI问生意) / 商品管理(SPU表格+SKU行内直改,库存必走/inventory/adjust留流水;搜索有词时忽略品类tab跨品类找;行内编辑成功弹"已保存"key去重) / 品类管理(卡片列表+新建/编辑/删除/设主营,新建含「✨AI配字段」=/ai/generate-fields返回fields+specs,FieldEditor两组商品字段/规格维度;编辑=删旧字段全量重建;解锁非预设行业新用户,产品灵魂"30秒配成自己行业") / 往来单位(客户+供应商双tab CRUD,客户按owed降序+总欠款条+展开常买/专属价) / 报表大屏(6+3张,员工卡片级隐藏利润·资金流水·员工业绩) / 对账单(客户/供应商,A4打印=index.css @media print 只留.print-area) / 批量导入(/ai/import-products→草案勾选→/products/batch,skipped明示) / 设置(店名/主营/员工管理/改密码)。
- **headless 测试坑**：antd Form 弹窗里的字段用 `#字段名`（antd 给 input 设 id=Form.Item name）选择器 fill，别用 @ref（modal 双渲染时 ref 映射歧义报 multiple elements）。antd **InputNumber** 用 native setter+input event 不触发受控更新，必须 browse `click @ref` 聚焦再 `type`。可展开表格的行内操作按钮，第一个 button 是展开箭头（客户行3按钮=展开/编辑/删除，供应商行2按钮）。

## 2026-08-07 App→Web 功能对照 + 补齐交易端（持续中）

- **App→Web 覆盖矩阵结论**：Web 原来是「配置+看板+对账」端，整条交易链（订单/收款/退货/进货/盘点/记账）全缺，后端接口全现成缺的是前端。矩阵全文见本次对话。移动端专属不做：扫码/语音采集/蓝牙打印/拍照OCR/OAuth。
- **已补 Web 页面**：订单管理 OrdersPage（列表+筛选全部/有欠款/已作废+日期，详情抽屉，收欠款/退货/作废，开单仍是App主场页面注明）。供应商欠款（suppliers.list 新增 owed/unpaidCount 纯增字段，PartnersPage 供应商 tab 显示欠款列+排序+总应付条）。新用户空店引导卡（DashboardPage productCount===0 时三步引导）。
- **已补 Web 页面（续）**：进货管理 PurchasePage（列表+建单选货录入+付款/退货/作废）。盘点 StocktakePage（列表+详情抽屉盈亏+新建盘点=列全部SKU填实盘数提交，差异自动落库存）。收支记账 LedgerPage（收入/支出双tab+日期筛选+区间汇总+记一笔+删除）。后两个由并行 Team Agent 开发、我集成真测。侧栏顺序：工作台/商品/品类/往来单位/订单/进货/盘点/收支记账/报表/对账单/导入/设置。
- **Web 待补（矩阵剩余）**：文本口述记账(/ai/parse-entry去语音,parseEntry返回多类型草案较复杂)、专属价可写(POST/DELETE /pricing)、编辑商品SPU(PUT /products/:id)、编辑品类字段(PUT .../fields/:fid)、商品图上传(POST /upload)、客户/供应商详情页、配方BOM、通知聚合页。
- **Team Agent 并行开发前端页面的坑**：agent 写的页面用受控 state 而非 antd Form 时没有 `#字段名` id，headless 测试要用 `snapshot @ref` 原生 fill/click；submit 按钮文字带空格（"保 存"），JS 匹配用 includes('保') 别用正则 /保存/；InputNumber type 会叠加旧值要先清空。
- **修了 orders.cancel 真 bug（已上生产）**：作废按 `item.quantity` 回退库存没减 returnedQty → 先部分退货再作废时退货过的货重复入库（库存虚高）。改为 `netQty = quantity - returnedQty`，netQty<=0 跳过。Web 订单管理让「先退货再作废」变常见才暴露。勾稽审计 36/0 通过 + 卖2退1作废库存守恒验证。生产备份 orders.js.bak-cancelfix。
- **权限三层**：菜单显隐(SideNav adminOnly) + 页内卡片级(isAdmin) + 后端 adminOnly 兜底。报表和设置对 staff 开放页面、只藏区块。
- **踩过的坑**：①antd 弹层/表格交互后 refs 漂移，headless 测试必须每步重新快照或 JS 按行文本定位；②/product-types 的 fields.options 是已解析数组不是 JSON 字符串；③商品图相对路径要 assetUrl 补 origin + server /uploads 加 CORP cross-origin 头；④品类带必填 sku 维度时建品必须随单发首个规格；⑤rowKey 与 selectedRowKeys 类型要一致（都 string）。
- 未做（诚实声明）：Web 商品图上传、规格值组合编辑（留 App）、通知中心、<1024px 移动适配。

## 2026-08-06 多租户隔离已上线（storeId，生产已部署）

- **机制**：`server/src/config/prisma.js` 是租户感知 Prisma 扩展客户端。auth 中间件把 storeId 放进 AsyncLocalStorage（`runWithTenant`），扩展层对 21 张业务表自动：读(findMany/findFirst/count/aggregate/groupBy) 并入 storeId；findUnique 查后校验归属（含强制补选 storeId 再剥离，防 select 绕过）；create/createMany 注入 storeId；updateMany/deleteMany 并入 storeId；upsert 用 base.findUnique 守卫复合键。**不拦截**：① 单条 update/delete（约定：调用方必须先经本店范围的读拿 id——全控制器已审计加前置 findFirst）② 嵌套 create（`items:{create}` 等不注入，必须显式 `storeId: getTenantId()`——orders/purchaseOrders/stocktakes/aiParse/productTypes 已补）。
- **注册=建店**：register/oauth 首登用 `$transaction` 原子建店+建号+播 3 套预设品类（`prisma/presetTypes.js` 共享，seed 也用它）。事务保证不留孤儿店。
- **业务单号每店独立**：Product.code/Sku.code/Order.orderNo/PurchaseOrder.orderNo/Stocktake.orderNo 从全局 @unique 改为 `@@unique([storeId, x])`（迁移 20260806100000）。否则按店 count 生成的序号跨店撞。username 保持全局 @unique（登录用）。
- **删号清店**：最后活跃用户删号=清本店 22 表 + Store 本体（deleteMany 天然按店过滤；AuthIdentity 无 storeId 需显式 `where:{user:{storeId}}`）。
- **回归测试**：`server/scripts/tenant-isolation-test.js`（21 断言，隔离临时库跑双店：隔离+跨店越权全404+每店独立单号+删号只清本店）。**改隔离逻辑必跑**。坑：迁移历史缺 Recipe 的 CreateTable，从零 `migrate deploy` 会失败——脚本和生产都用 `db push` 建表。
- **注册已恢复**：生产 .env 已移除 ALLOW_REGISTRATION（止血闸撤除）。生产真验过：注册测试店→隔离+越权404→删号无残留→review 数据完好。
- 生产部署：`ssh -i ~/.ssh/id_ed25519_tencent root@qxju.shop`，代码 /opt/stockmate/server，库 `prisma/prod.db`（不是 dev.db！），PM2 名 stockmate-server。升级走 rsync src+prisma → `prisma generate` → `db push --accept-data-loss` → 建 Store(1)。备份：prod.db.bak-pretenant-*。

## 2026-08-06 法务三件套 + 国际化后的新事实

- **法务三件套**（`app/lib/core/legal.dart`）：首启隐私同意页 PrivacyGate（挂在 MaterialApp.builder，SharedPreferences 键 privacy_agreed_v1，不同意 exit(0)；builder 层没有 Navigator 所以用整屏条件渲染而非 showDialog）；登录页底部协议链接行；我的页 隐私政策/用户协议 入口（url_launcher 打开 Safari）。线上三页：qxju.shop/stockmate/{privacy,terms,support}。
- **集成测试须预写同意标记**：setUpAll 里 `setBool('privacy_agreed_v1', true)`，否则同意页挡住一切。
- **国际化=跟随系统**：flutter_localizations delegates + supportedLocales [zh_CN,zh,en] + Info.plist CFBundleLocalizations（iOS 不声明就拿不到系统语言）。业务文案仍是硬编码中文（全量 arb 翻译未做）。模拟器已被设为中文系统。
- 报表日期 chips 行已包 SingleChildScrollView 横滚（原 Row 溢出 8px）。

## 2026-08-07 勾稽审计挖出的 3 个真 bug（已修复+回归全绿）

- **勾稽审计脚本**：`server/scripts/biz-loop-audit.js`（36 项，隔离库 3197）——模拟三画像完整生意周期（开店/进货/专属价/挂账/口述/收款/退货/报损/盘点/员工403/总对账）。改动业务逻辑后必跑。跑法见文件头注释。
- **Bug1 口述 0 元单**：口述不说价（常态）落账 actualAmount=0 白送货 → aiParse enrich 现用选中规格的建议价（专属>上次>标价）自动补齐 + warning 告知，确认卡所见即所落。
- **Bug2 散客赊账跑单**：散客单实收<应收照单全收，欠款无处追 → orders.create 拦 400"散客订单需当场结清，要赊账请先选择客户"。
- **Bug3 多规格口述误扣整箱**：口述"5瓶单瓶的"落账扣了整箱 sku（5×2800=14000）→ enrich 规格词匹配（先 item.name，再原始口述全文但仅唯一命中才用），响应带 `suggestedSkuId`，App models.dart fromJson 优先跟随。
- **退货逻辑验证是对的**：收1000退236 → 挂账冲到0 + refundCash=56（direction=out 真流水），钱一分不消失。审计脚本一度误判，商业预期应为"冲到0+退现"而非负欠款。
- 遗留观察：报损记录可查（出入库流水）但报表中心无"本月损耗金额"汇总（刘哥画像的灵魂问题），待做。

## 2026-08-07 二轮勾稽审计（audit2）的发现与修复

- **二轮审计脚本**：`server/scripts/biz-loop-audit2.js`（29 项，隔离库 3196）——进货退货/订单取消/超额收款/收摊总账/软删商品/专属价回落/进货补付/损耗汇总。与 audit1（36 项）一起构成业务回归双保险。
- **Bug4 资金流水 NULL 误杀（SQL 三值逻辑）**：cashflow 的 `NOT: { account: '冲账' }` 连带排除 account=NULL 的行（开单未选结算账户即 NULL）——开单随收/付欠款全从资金流水消失。修：`OR: [{account: null}, {NOT: {account: '冲账'}}]`。**教训：Prisma/SQL 里 NOT 条件必须想 NULL**。
- **Bug5/6 取消单不退款**：销售单/进货单取消只回库存不处理已收付的钱 → 资金流水虚高。修：cancel 时 paidAmount>0 自动生成反向 PaymentRecord（销售 out"取消订单退款"/进货 in"取消进货单退款收回"）。
- **损耗汇总已做**：/reports/profit 返回 lossAmount（报损/过期/损坏 × 当前进价估算，单列不并入利润口径）；App 利润卡显示"另有损耗 ¥xx"。
- 验证过正确的行为：期初库存有流水（reason=建品初始库存）；超额收款/付款双向拦截；软删商品五连（列表剔除/历史单保名/禁开单/报表剔除）；收摊总账进利润报表且有双计警告（M18）。
- 审计教训：两次"失败"其实是我算术错（30-5-2+2=25 不是 27；po2 付款与取消收回相抵）——**先怀疑考卷再怀疑系统**。

## 2026-08-08 体验优化轮的新事实

- **开单草稿三件套**（order_create_screen.dart）：override setState 统一防抖落盘（500ms，不用在十几个变更点逐个插调用）+ dispose 兜底快照 + 提交成功 `_submitted` 熔断（防 dispose 把已提交的单存回去）。key=sale_draft_v1。带预填参数（锁客户/再来一单）进入时不恢复草稿。回归测试 `integration_test/sale_draft_test.dart`。
- **开单成功加了 HapticFeedback.mediumImpact**（收银"叮"感）。
- 体验扫描结论（代码级）：数量/金额输入框 keyboardType 全齐（两处疑似是误报——单位/粘贴导入本来就是文本）；提交防连点全齐（开单/进货/口述都有 _saving 守卫）；下拉刷新 10 页全覆盖。
- 集成测试再+1（现 4 文件：core_flows×2 + voice_recover + sale_draft），全绿基线 2026-08-08。

## 2026-08-08 第三轮审计 + AI 补齐

- **Bug7 时区（真 bug，最隐蔽）**：报表按日走势/首页趋势/AI 快照的"今天"都用 `toISOString()` 取日期——那是 UTC，北京时间 00:00-08:00 的单全算到前一天（早市摊主的货全记昨天）。修：新增 `biz.localDayKey()`（本地时区），三处替换；并在 `app.js` 首行钉死 `process.env.TZ ||= 'Asia/Shanghai'`（换 UTC 机器部署也不复发）。审计脚本 audit3 在凌晨窗口真实复现并验证。
- **audit3**：`server/scripts/biz-loop-audit3.js`（15 项，隔离库 3195）——时区边界/跨月对账结转/并发开单丢失更新/分页边界。跨月与并发本来就正确（Prisma 事务在 SQLite 下无丢失更新，10 并发库存精确）。
- **AI 问生意补齐两处缩水**：① App 端从不传 history（后端早支持多轮）→ `ask_screen.dart` 现带最近 3 轮，"那昨天呢？"能正确理解；② 快照没有今日/昨日明细（首页却有"昨天"那行）→ `buildBusinessSnapshot` 加 `今日`/`昨日` 切片（1号时昨天不在本月则明示不给，不给错数）。
- **取图统一加"拍照"**：`core/pick_image.dart` 的 `pickImageWithChoice`（拍照/相册二选一），四处接入（账单截图/送货单/商品主图/规格图）——送货单就在手上，只给相册等于逼用户退出 App。Info.plist 相机文案同步扩写。
- **SQLite 删库重来必须 `rm -f xxx.db*`**（含 -wal/-shm，否则数据还在 WAL 里，审计脚本会撞上"用户名已注册"）。
- **造历史数据要写 unix 毫秒**：Prisma 在 SQLite 存 DateTime 为 INTEGER ms，`UPDATE ... SET createdAt='2026-07-15 10:00'` 写文本会被读成废值（audit3 一度全红就是这个）。

## 2026-08-08（下半场）文案核查揪出的合规与缩水

- **隐私声明曾不准确（已修）**：线上隐私政策与 App 首启同意页都写过"语音在设备本地转文字"，但 `SpeechListenOptions` 没设 `onDevice`（默认 false），iOS 可能把音频送 Apple 服务器。**选择改文案不改代码**（开 onDevice 中文长句识别率大跌，而口述记账全是长句）。现口径："语音由 iOS 系统转文字（可能经苹果服务器），音频不会传到我们的服务器"。三处已统一：privacy.html / legal.dart 同意页 / 审核备注。
- **App 内补了「帮助与联系我们」入口**（我的页），指向 qxju.shop/stockmate/support——之前用户在 App 内找不到反馈渠道会直接去评论区发差评。
- **PrivacyInfo.xcprivacy 补齐 5 类**（邮箱/电话/地址/用户ID/照片），与隐私标签申报口径一致。
- **审核 demo 账号已种满**：`server/scripts/seed-demo.js`（幂等，跑法见文件头）——3 品类 / 20 商品（整箱+单瓶双规格带条码）/ 11 客户（5 家有欠款）/ 5 供应商 / 33 销售单 / 10 进货单 / 专属价 / 退货冲减 / 报损 / 开销。**注意毛利必须为正**（曾因重复种开销变成 -2522，观感极差，现已加幂等保护，当前毛利 ¥157.4）。
- **提审文案已成稿**：`docs/appstore-listing.md`（名称/副标题/描述/关键词/隐私标签/审核备注/截图脚本 9 节 + 待人确认清单）。
- 文案红线（代码核实过，不许吹）：不能说"拍照识别"→现已支持拍照故可说；不能说"断网能翻商品库存页"（商品 Tab 无缓存，只有选货弹窗/客户/供应商/品类有）；不能说"推送提醒"（通知中心是打开才聚合，零 push）；不能提微信/华为登录（UI 未渲染）；不能把"记一笔收入/支出"当独立功能（无浏览/删除页面）。

## 2026-08-08（晚）App Store 截图流水线

- **一键出图**：`app/scripts/shoot.sh [udid]`（默认 iPhone 17 Pro Max = 6.9" 1320×2868，App Store Connect 直接可传）。原理：`integration_test/screenshot_driver_test.dart` 真手点导航到 6 个页面，每站 `print('SHOT:名字')` 后停 7 秒，shell 端 tail 日志见标记就 `simctl io screenshot`。产物在 `docs/screenshots/`。
- **踩过的坑（都写进脚本了）**：
  1. 集成测试直接 pumpWidget **不会走 main() 的自动登录** → 必须在 setUpAll 里自己 `Api.I.post('/auth/login')`。
  2. `t.pageBack()` 找的是英文 tooltip "Back"，**接了国际化后中文是"返回"** → 用 `find.byTooltip('返回')` 兜底（`_back()`）。
  3. simctl 各种写偏好都绕不过首启隐私同意页（新版 shared_preferences 存储位置对不上）→ 干脆在测试里点一下"同意并继续"。
  4. 系统权限弹窗（语音识别）会盖住截图且 simctl 无法点掉 → 根治办法是**别在 initState 里 initialize 语音**（改成点麦克风时才申请，本来也更符合 HIG）。
  5. iOS 键盘"滑动输入"教学浮层盖半屏 → shoot.sh 里 `defaults write com.apple.keyboard.preferences DidShowContinuousPathIntroduction -bool true`；输完文字要 `FocusManager.instance.primaryFocus?.unfocus()` 收键盘。
  6. 状态栏统一 9:41 满电：`simctl status_bar override`（苹果宣传图惯例）。
  7. 购物车截图别去模拟"搜索→点商品→选规格"，**直接预置 `sale_draft_v1` 草稿**最稳（复用草稿恢复功能）。
- **顺带修的真缺陷**：`SoftCard` 用 Container+背景色包住 ListTile，水波纹画在卡片背景之下——"我的"页所有菜单行**点下去没有任何反馈**。已在卡内加一层透明 Material。（这个是 Flutter 的 debug assertion 报出来的，之前一直被当"测试噪音"。）
- **demo 数据坑**：种子给品类填必填规格时，如果品类的规格键不是 `spec`（AI 生成的酒水用的是 volume/packaging），硬塞会渲染出"整箱 · 250ml · 单瓶"这种自相矛盾的规格串。种子脚本已加判断；历史单据的 specText 快照需要单独刷。

## 2026-08-08（晚 2）改价卡死 + 底栏布局

- **Bug8「点编辑价格页面就卡了」= 老坑第三次咬人**：主题里 `minimumSize: Size.fromHeight(52/48)` 意味着**最小宽度=无限**，按钮裸放进 Row 就会每帧抛 `BoxConstraints forces an infinite width`，表现就是页面卡死。这次是开单页改价面板的「确定」键（order_create_screen.dart 的 `_editCartLine`）。修法同前：`style: FilledButton.styleFrom(minimumSize: const Size(96, 48))`。
  - 已做全局扫描（Row 内裸放 Filled/Outlined 按钮），除此处外只剩 3 处误报（都在 Column 里，宽度有界，不受影响）。
  - **没有改主题**：多数按钮靠主题隐式撑满（只有 12 处显式 `width: double.infinity`），改成有限宽会让一批按钮缩成内容宽，视觉回归面太大。规矩仍是：**按钮进 Row 必须 Expanded 或显式 minimumSize**。
- **订单详情底栏重排**：原来 4 个按钮挤一行，中文标签被挤换行（"退/货"、"分享单据图/片"）。现在次要动作（退货/再来一单/打印小票）用 `_MiniAction`（等宽、图标在上文字在下，永不换行），主动作「分享单据图片」独占整行。
- **新增两个回归测试**：`integration_test/edit_price_test.dart`（改价面板能开/能改/合计跟着变）、`integration_test/verify_order_detail_test.dart`（底栏四动作齐全不崩布局）。集成测试现 6 个文件全绿。
- 顺带确认：**按客户改价这件事本来就是完整的**——三级价格解析（客户专属价 > 该客户上次成交价 > 标价）在 `server/src/controllers/pricing.js`，开单行点一下就能改价改量，改价面板里有「记为「某客户」的专属价，下次自动用」勾选（选了客户才出现）。

## 2026-08-08（夜）补分批次：运维 40% / 体验 25% / 工程 20% / 上架 15%

### 生产运维（3.5 → 7.0）
- **数据库备份**：`/opt/stockmate/backup.sh` + cron 每天 03:20，保留 30 天，日志 `/opt/stockmate/backups/backup.log`。用 `sqlite3 .backup`（在线热备，不能用 cp——cp 出来可能是撕裂的）。**脚本自带完整性自检**（integrity_check + 关键表行数），不通过就删掉备份并退出非零。
- **恢复演练已真做**：解压备份 → 用真后端挂载在 3199 → 登录 + 拉数据，与生产完全一致（20 商品 / 33 订单）。**没验证过能恢复的备份不算备份。**
- **崩溃上报（自建，不接第三方）**：`app/lib/core/crash_report.dart`（FlutterError.onError + PlatformDispatcher.onError + runZonedGuarded，去重 + 每会话上限 20 条，失败静默）→ `POST /client-logs`（无需登录，崩溃可能发生在登录前）→ ClientLog 表。**故意不做查询 API**（那会让任意店主看到别人的堆栈），运维用 `node scripts/errors.js` 看，带出现次数排行。不接 Sentry/Firebase 的原因：会引入行为追踪，与"不做画像追踪"的承诺冲突且要改隐私标签。
- **接口限流**：`src/middlewares/rateLimit.js`（零依赖内存实现）。auth 60/5分钟/IP（防撞库）、ai 120/小时/账号（**防刷 DeepSeek 烧钱**）、全局 1200/分钟/IP。阈值可用环境变量覆盖（RATE_AUTH_MAX 等），设得比真实用量宽松很多，审计脚本和集成测试都不会被误伤（已验证 audit1 36/0 不受影响）。
- **健康检查升级**：`GET /health` 现在真查一次库（`SELECT 1`）并返回 dbMs/uptime；只看进程存活的监控会在"DB 坏了但 Node 还活着"时一路绿灯。

- **运维体检端点** `GET /health/ops`（与 /health 分工：/health 管"服务活着吗"，ops 管"运维状态健康吗"）：返回 db 状态 + 最近备份时间 + 备份份数；**备份超 36 小时未更新或从未备份 → HTTP 503 + 中文原因**。把"没人看的日志"变成了状态码——任何免费 uptime 监控（UptimeRobot 之类）指到这个地址，就等于有了备份告警，不需要任何第三方凭据。失败路径已实测（无备份/备份过期两种场景都正确 503）。

### 用户体验（6.5 → 7.0）
- **窄屏布局体检**：`integration_test/narrow_layout_test.dart` — 把视口压到 iPhone SE 尺寸（375pt）走一遍主 Tab + 开单 + 订单详情 + 我的下 8 个二级页，自行收集溢出/无限宽异常一次性报出（不让第一处失败中断走查）。这是对"按钮被主题无限宽撑爆/中文标签被挤换行"那一类问题的系统性防线。当前全绿。

### 工程质量（7.0 → 8.5）
- **后端单测从 0 到 162 个**（`server/test/`，Node 20 内置 node:test，零新依赖）：aiGuard 四个清洗器、biz.localDayKey 时区口径、pricing 三级价格解析、金额取整浮点边界。
- **租户隔离回归 21 项**（`scripts/tenant-isolation-test.js`）。
- **一键验证**：`npm run verify`（单测 + 租户隔离）。无远程仓库所以不做 CI，用这个替代。

### 上架就绪（7.5 → 8.0）
- **关于页** `/about`（我的 → 关于智存）：版本号 + **ICP 备案号**（`legal.dart` 的 `icpFiling` 常量，为空时显示"备案办理中"，号下来只改这一个字符串）+ 隐私/协议/帮助入口。工信部要求 App 内显著位置展示备案号。

### 仍未到 8 分的两项（都卡在我做不了的地方）
- 运维 7.0：**备份只有本机单副本**（服务器整机挂了就没了），且备份失败只写日志**没有告警通知渠道**。要异地备份/告警需要你提供对象存储或通知渠道凭据。
- 体验 7.0：**真机验收未做**（语音正向识别、拍照 OCR、蓝牙打印、Apple 登录都只能在真机验）。

## 2026-08-08（夜 2）单测 agent 挖出的缺陷（2 个已修，4 个待定）

- **Bug9 资损级「没说进价 → 进价 0」（已修）**：提示词明令 AI"信息缺失填 null"，而 `aiGuard.num()` 里 `Number(null) === 0`（JS 坑），于是"不知道"被洗成"0 元"；confirmEntry 的 `if (unitCost != null)` 判 0 为真 → **把商品原有成本价静默抹成 0**，毛利虚高一倍；更阴的是 stats 的 `profitUnreliable` 判的是 `== null`，0 不是 null → **连"这单没填进价"的诚实提示都不会亮**，老板看到一个自信的错数字。修：`num()` 先挡 null/空串/纯货币符号/布尔。测试已从"固化缺陷"翻成"期望正确"。
- **Bug10 单号并发撞车（已修）**：`genDocNo` 用 count+1 推序号，两台手机同一瞬间开单拿到同一个号；有 `@@unique([storeId, orderNo])` 兜底所以不会重号，但**第二个人会看到"开单失败"**。修：占号检查 + 顺延取空号（最多 10 次），极端情况退到时间戳后缀——宁可单号不连号，也不能让老板开不出单。
- **待定 4 条**（记录在案，未改）：① sanitizeParseEntry 用 `...it` 展开，AI 多塞的键原样透传给前端（应白名单化）② discountAmount 显式传 0 会被 discountRate 覆盖（0 是假值）③ 未取整的 total 参与折扣计算，让利额比数学期望少 1 分 ④ 前端单测仍只有 2 个文件。
- **测试资产**：`server/test/` 163 个单测 + `scripts/tenant-isolation-test.js` 21 项，`npm test` / `npm run verify` 一键跑。
- **方法论**：让写测试的人**只报告不修**是对的——它固化成"【已知缺陷】"用例，我逐条读完再决定修不修、怎么修，比它直接改安全得多，也留下了修复前后的对照。

## 2026-08-08（夜 3）待定 4 条全部处理 + 单测又挖出 1 个真 bug

- **Bug11「客户给了钱却被记成欠款」（新发现，已修，信誉级）**：`ParsedSale.fromJson` **压根没解析 `paid` 字段**。链条：AI 正确识别"他当场给的现金"→ 返回 `paid:true` → **App 模型层丢掉** → 确认时不带 paid → 后端 `isCredit = !saidPaid && isNamedCustomer` 判成挂账 → **系统记客户欠钱，老板去找已经付过钱的客户要账**。之前三轮审计都直接打后端 API，绕过了 App 模型层，所以从没抓到。修：`paid: j['paid'] as bool?`。已用真 AI 端到端确认解析侧返回 true。
- **待定 4 条已全部处理**：
  - ① **AI 字段透传 → 白名单化**：sanitizeParseEntry 不再用 `...it` 展开，只放行流程用得到的字段（AI 想往卖出条目里塞 costPrice 之类都进不来）。
  - ② **折扣金额显式 0 被折扣率顶掉 → 改用 `== null` 判断**：老板填「优惠 0 元」就是不优惠（0 是假值的经典坑）。
  - ③ **金额精度 → `biz.money()` 统一两位取整**：逐行小计取整后再累加，折扣按取整后的 total 算。原来靠 SQLite 写入时碰巧抹平脏浮点（0.7×3=2.0999999999999996），那是巧合不是保证——脏值只要参与一次折扣计算就少 1 分。销售单和进货单都修了。
  - ④ **前端单测**：新增 `app/test/models_test.dart` 18 项（fmtQty 各种边界、ParsedSale 规格跟随/价格优先级/挂账语义、ParseResult 空响应）——**Bug11 就是这批测试抓出来的**。
- **测试资产总览**：后端 163 单测 + 21 租户隔离 + 审计 36/29/15 + AI 19；前端 18 单测 + 10 个集成测试文件。
- **教训**：审计脚本直接打 API 会漏掉"App 模型层丢字段"这类 bug。**端到端要真的端到端**——要么走 UI，要么给模型层单独补测。

## 2026-08-09 权益层（订阅的地基，不含支付不含定价）

**设计原则：买的是「权益」，权益挂在店铺上，支付渠道只是权益的一个来源字段。**
反过来把订阅状态和某渠道交易号绑死，将来上第二个渠道就要迁移数据——那时已经有真实付费用户了。

- **数据**：`Entitlement`（storeId / plan / **source: apple|web|android|manual** / status / externalId / expiresAt）+ `AiUsage`（按店按天按环节累计调用次数）。`@@unique([source, externalId])` 保证渠道回调幂等（回调必然重复）。
- **接口**：`src/utils/entitlement.js` — `currentPlan()` / `grantEntitlement()` / `revokeEntitlement()` / `recordAiUsage()` / `monthlyAiCalls()`。业务代码永远只问 currentPlan 一个问题，不关心钱从哪来。
- **计量+闸门**：`middlewares/aiMeter.js` 挂在 6 个 AI 接口上。**现在只记不拦**——`FREE_AI_MONTHLY` 不配就是不限量。将来要开额度只需加个环境变量，不改代码。超额返回 402 且文案明确说"手动开单记账看报表都不受影响"（免费档永久可用是写进 App 的承诺）。
- **App 侧**：`GET /me/entitlement` 返回 plan/source/本月已用/额度上限。
- **人工发放**：`node scripts/grant.js <用户名> pro 365` / `... revoke`（内测、补偿、线下成交都走这里）。
- **测试**：`test/entitlement.test.js` 11 项（免费兜底/按店隔离/过期失效/永久权益/多渠道取最长/回调幂等/退款撤销/计量隔离）。后端单测总数 174。

### 合规边界（写死，别忘）
- **架构解耦 ≠ 可以不接内购**。iOS 卖数字内容必须提供内购（3.1.1）；可以**同时**承认官网买的权益（多平台服务条款），但 **App 内绝不能出现任何指向站外购买的按钮/链接/二维码/文案暗示**（反引导条款，审核红线）。
- "App 内限额 + 只能去 Web 解锁"是高频拒审模式，不要走。
- 抽成实际是 15%（小企业计划，年收入 100 万美元以下）；国内个体商户安卓占多数，iOS 抽成影响的只是总收入的两三成 × 15% ≈ 3~5%——不值得为省这点冒拒审风险。
- 渠道建议：**Web 主战场**（毛利最高、无审核约束、可随时改价验证定价）→ 安卓自主发行零抽成 → iOS 老实接内购、价格加一档吸收抽成。微信小程序 iOS 端禁虚拟支付，只能当获客入口不能当收款渠道。

### 还没做（有意）
定价、真实支付接入（苹果内购/支付宝）、订阅续期与退款回调处理。**等上架后有真实 AI 用量分布再定价**——现在拍脑袋定的数字一定是错的，而管道已经埋好，那时接任何渠道都不用改数据。

## 2026-08-09 免费额度的折中方案（不收钱也不失控）

约束：个人身份，无营业执照 → 办不了微信/支付宝商户号 → Web 收款走不通；iOS 内购可行但只是一个渠道。
矛盾：不能收钱，又不能无限白送 AI token。折中方案 = **在"额度怎么给"上做文章**，四条腿：

1. **按天不按月**（`FREE_AI_DAILY_CORE` / `FREE_AI_DAILY_OTHER`，生产已设 8/5）。月额度的毛病是"月初挥霍月末干瞪眼"，用户撞墙后整月都在生气；按天给，明天就恢复，成本上限一样（日额度×30）。
2. **好钢用刀刃**：口述记账（parse-entry/confirm-entry）单独一份额度，AI 问生意/生成商品/粘贴导入共用另一份小额度。不分桶的话，用户点几次"生成商品"就把当天的记账额度耗光了。
3. **超额软着陆**：402 + 文案说清「明天 0 点恢复」和「手动开单一样快，记账报表对账都不受影响」。基础功能永久免费是写进 App 的承诺，不能破。
4. **提示词瘦身（纯降成本，用户无感）**：`biz.narrowForPrompt()` —— 原来把**全部**商品和客户拼进口述提示词，500 个商品的店每次都在为 490 行不相关内容付费。现在只保留「名字里有中文字出现在这句话里」的条目。实测 300 商品目录省 56~83%。
   - **只按中文字匹配**：数字/字母是噪音源（"500ml" 会被口述里的 "192" 命中，一匹配全中，过滤形同虚设）。
   - **单字而非词组匹配**：要让"青啤"能命中"青岛啤酒"。宁可多带绝不漏。
   - **红线是不能漏**：漏了商品 AI 就永远匹配不上，用户看到"没有商品档案"，比多花钱严重得多。`test/narrowPrompt.test.js` 10 项专门锁这个性质。

### 成本账（实测单次约 6 厘）
日额度 8+5 → 单人月成本上限约 2.3 元；1000 用户封顶约 2300 元/月。叠加提示词瘦身后实际会低得多。
没有额度时，风险不是"平均用户花多少"，是"**最疯的那个用户能花多少**"——一个死循环就能刷爆。

### 备选（暂未做）
用户自带 DeepSeek API Key：重度用户填自己的 key，成本转移、完全绕开支付与资质。缺点是太极客，只适合 5% 的重度用户当泄压阀。

后端单测 184 全绿。
