# App Store 上架文案（中国区）· 智存 StockMate

> 起草时间：2026-08-08
> 事实源：`CLAUDE.md` / `docs/zhihuiji-teardown-2026.md` / `docs/appstore-audit-2026-08-05.md` + `app/lib/features/` 逐页 grep 核实
> **原则：每一条功能描述都在代码里有对应实现**。文末「⚠️ 我不确定的地方」列出需要人确认的点，提交前请逐条过一遍。

---

## 1. App 名称（上限 30 字符）

| | 方案 | 字符数 | 说明 |
|---|---|---|---|
| **主选** | `智存-AI进销存` | 8 | 已定。干净、无堆砌风险，`进销存` 是最大流量词 |
| 备选 1 | `智存-语音记账进销存` | 10 | 押注「语音」这个竞品真空地带（智慧记连语音开单的官方教程都没有） |
| 备选 2 | `智存-进销存库存管理` | 10 | 最保守的 ASO 打法，吃「库存管理」第二大词，但丢掉了 AI 心智 |

命名注意：中国区对名称里堆关键词查得比以前严（2.3.7），三个方案都在安全区。**主选保留 AI 二字**——它是这个 App 唯一的记忆点，也是和智慧记正面差异化的地方。

---

## 2. 副标题 Subtitle（上限 30 字符）

| | 方案 | 字符数 | 打法 |
|---|---|---|---|
| **推荐** | `说一句话，进货卖货欠款全记好` | 14 | 直接把核心交互摆出来，痛点（欠款）也带上了 |
| 备选 B | `开单、库存、欠账，说句话就记完` | 15 | 功能词更全，搜索覆盖略好，但少了画面感 |
| 备选 C | `AI帮你配好，你这行的进销存` | 14 | 主打「30秒配成自己行业」这条产品灵魂，适合后续 A/B 换 |

---

## 3. App 描述（上限 4000 字符）

> 前 3 行是黄金位（折叠前只显示这些）。下面正文可直接复制粘贴。

```
记不清今天卖了多少？月底算不出谁还欠着钱？
对着手机说一句「老王拿了3箱啤酒280」，进货、卖货、开销、欠账，智存全替你记好。
不用学、不用自己搭表格——你是做哪行生意的，AI 30 秒帮你配好。

【说一句话就记账】
打开 App 第一屏就是那个麦克风，不用翻三层菜单。
说「今天进了20箱青岛，卖了3箱给老王，给帮工发了200」——进货、卖货、开销、一天的总营业额，AI 一次全拆开分好。
不方便说话就打字，一样能记。
记完先给你看一张确认单：商品、数量、价格、客户，一条条都能改，你点「确认无误」才真的进账本。AI 说了不算，你说了才算。

【30 秒配成你这行的样子】
卖酒的关心度数和箱规，卖水果的关心产地和斤两，卖衣服的关心颜色尺码。
新建品类的时候告诉 AI 你做什么生意，它把这行该有的商品字段和规格维度都配好，不用你对着空表格发呆。
旧账搬家：Excel、老软件导出的表、甚至微信里客户发的订货消息，整段粘进来，AI 帮你拆成商品录进去。它读不懂的会原样列给你看，不会假装全导进去了。

【开单、收钱、要账，一天的活都在这】
开单：选货、改价、打折、收钱一屏搞完。没记名字的客人直接按散客开，不卡你。
挂账：谁欠多少、欠了几单，客户列表按欠款从多到少排好，收一笔记一笔。你欠供应商多少，同样一目了然。
退货、作废、补收款，钱和库存跟着一起对上，不会算糊涂。
单子能生成图片发微信给客户，也能连蓝牙小票机打出来。

【生意上的事，直接问】
「现在谁欠我钱？」「这个月赚了多少？」「什么卖得最好？」「哪些货要补了？」
打字问就行，它照着你店里的真实数据回答。答不上来会直说答不上来，不给你编数字。

【9 张报表，月底不用自己算】
经营利润、销售统计、热销分析、进货统计、员工业绩、库存统计、资金流水、客户对账单、供应商对账单。
对账单能直接发给客户和供应商。

【扫码、盘点、请帮手】
扫商品条码直接加库存减库存；没有条码手输编码也能查。
盘点：实盘数填进去，差多少自动调库存，还留一条记录，账不会不明不白地变。
请了帮手可以开员工账号，利润、资金流水、员工业绩这些只有老板看得见。

【适合谁】
· 馄饨店、水果店、便利店——每天都在重复「进货、卖货、收钱」的小店
· 酒水、副食、日杂批发——天天跟客户挂账、月月要对账的
· 一个人干，或者带一两个帮手
· 用惯了手写本和 Excel，但月底越算越糊涂的

【我们没做的，也直说】
· 连锁多门店、多仓库分开管——没做（一家店一个账号）
· 收银台、POS 扫码枪、会员储值积分——没做
· 微信订货商城、代理商分销——没做
第一年我们只想把「一个店，把账记清楚」这件事做到底。做多了必然做浅，那对你没好处。

【几句实在话】
· 开单、进货、库存、报表不限单据数量，不会用到 100 单就弹窗逼你付费。
· 设置里有「导出全部数据」，随时把商品、订单、客户全导成 Excel 能开的表格或 JSON 拿走。这个功能永远免费，我们不锁你的数据。
· 不想用了，App 里直接删除账号，数据一起清掉，不用发邮件求人。
· 你的经营数据存在我们的服务器上，所以需要联网。断网的时候，开单页里挑货、翻客户和供应商还能读到上次的数据，但下单、记账、看报表都得等网络回来——我们不做假的「离线开单」，那容易让两边的账对不上，宁可说实话。
· AI 功能（口述记账、配字段、问生意）需要把相关文字发给第三方大模型服务处理，具体写在隐私政策里，介意的话可以只用手工录入，功能一样完整。
```

字符数约 1180，远在 4000 以内，还有余量加内容。

**为什么这么写：**
- 开头不写「赋能」「一站式」「闭环」，因为馄饨摊老板不说这话。第一句直接是他昨天晚上真实的困扰。
- 「我们没做的，也直说」这一段反直觉但值钱：它筛掉了会给一星差评的重型批发用户，也顺手把「不做多店多仓」这个战略选择讲成了优点。
- 最后一段主动交代联网、第三方 AI、离线限制。审核员看得见，用户也看得见——把丑话说在前面，比上线后被骂「骗人」划算。

---

## 4. 关键词 Keywords（上限 100 字符，逗号分隔不留空格）

```
库存管理,出入库,开单,记账,仓库,盘点,对账单,应收账款,进货,销售,商品管理,批发,零售,便利店,水果店,小卖部,记账本,店铺管理,送货单,台账,语音记账,库存表,采购,门店,小超市,赊账
```

96/100 字符，26 个词，无空格（脚本实测，不是估的）。

**用法提醒：**
- App 名称和副标题里的词（`智存`/`AI`/`进销存`/`说一句话`/`卖货`/`欠款`）苹果已经单独索引，**不要在关键词里重复浪费额度**。
- 如果最终选了推荐版副标题（含「进货」「卖货」），把关键词里的 `进货` 删掉，能腾出 3 个字符，建议补 `日结` 或 `个体户`。
- 没放 `收银`：我们没有收银台，用这个词引来的用户装完就删，还会留差评。ASO 上骗流量是负收益。

---

## 5. What's New（1.0 首版）

```
1.0 第一个版本，主要是这些：

· 说一句话记账：进货、卖货、开销、当天营业额，AI 拆开分好，你确认了才入账
· 开单收钱、挂账要账、退货作废——钱和库存一起对上
· 告诉 AI 你做什么生意，30 秒配好这行的商品字段和规格
· 9 张报表 + 客户/供应商对账单，能直接发微信
· 扫码出入库、盘点单、员工账号权限
· 全部数据随时导出，永远免费

用着哪儿别扭、缺什么功能，欢迎在评论里直接说，我们看得到。
```

---

## 6. 推广文本 Promotional Text（上限 170 字符，可随时改不用过审）

```
对着手机说一句「老王拿了3箱啤酒280」，进货、卖货、欠账，AI 替你记好，你确认无误才入账。开单、库存、对账单、9 张报表都不限单数，数据随时全部导出。
```

77/170 字符。这个字段不用重新提审就能改，建议留着做活动位（比如后续「新用户 XX」或节日文案）。

---

## 7. App 隐私标签逐项答案

> 依据：`app/ios/Runner/PrivacyInfo.xcprivacy`、`prisma/schema.prisma`（User / AuthIdentity / Customer 模型）、`pubspec.yaml`（无任何分析/广告 SDK）、`login_screen.dart`（Apple 登录申请 fullName + email）

### 7.1 是否用于追踪（Tracking）

**否。** 全部数据类型的「用于追踪」一律选「否」。
依据：无 IDFA、无 ATT 弹窗、无任何第三方分析或广告 SDK（`pubspec.yaml` 21 个依赖全是功能性的），`PrivacyInfo.xcprivacy` 里 `NSPrivacyTracking=false`、`NSPrivacyTrackingDomains` 为空。

### 7.2 收集的数据类型

| 类别 | 具体项 | 收集 | 与用户关联 | 用途 | 依据 |
|---|---|---|---|---|---|
| 联系信息 | 姓名 | ✅ | 是 | App 功能 | 注册填 `realName`；Apple 登录返回 `fullName` 存 `AuthIdentity.displayName`；另有店主录入的**客户/供应商名称** |
| 联系信息 | 电子邮件地址 | ✅ | 是 | App 功能 | Apple 登录 scope 含 email，存 `AuthIdentity.email`（可能是 Apple 私密转发地址） |
| 联系信息 | 电话号码 | ✅ | 是 | App 功能 | `User.phone`（选填）+ **`Customer.phone`（店主录入的客户电话）** |
| 联系信息 | 实际地址 | ✅ | 是 | App 功能 | `Customer.address`（店主录入的客户送货地址） |
| 标识符 | 用户 ID | ✅ | 是 | App 功能 | `username`（登录账号）+ 租户 `storeId` |
| 用户内容 | 照片或视频 | ✅ | 是 | App 功能 | 商品图片上传；进货单据拍照识别（`image_picker`） |
| 用户内容 | 其他用户内容 | ✅ | 是 | App 功能 | 商品、库存、订单、进货单、客户/供应商、收支记录、盘点单、口述记账的文字内容 |
| 用户内容 | 音频数据 | ❌ | — | — | **见 7.3，这一项建议不勾** |
| 通讯录 | 全部 | ❌ | — | — | 不读设备通讯录，客户资料全是手工录入（Info.plist 里没有 `NSContactsUsageDescription`） |
| 位置 | 全部 | ❌ | — | — | 无定位权限、无定位代码 |
| 财务信息 | 全部 | ❌ | — | — | 无内购、不接支付、不碰银行卡。注：店主记的「营业额/成本」属于其经营数据，按用户内容申报，不算财务信息 |
| 健康与健身 / 敏感信息 / 浏览记录 / 搜索记录 / 购买项目 | 全部 | ❌ | — | — | 无 |
| 使用数据 / 诊断 | 全部 | ❌ | — | — | 无埋点、无崩溃收集 SDK |

### 7.3 关于「音频数据」为什么建议不勾（重要，请人工拍板）

代码事实（`voice_entry_screen.dart:127-140`）：语音由 `speech_to_text` 调 iOS 系统 `SFSpeechRecognizer` 转成文字，**录音本身从不发到我们的服务器，我们只收到转好的文字**。

按苹果对「收集」的定义（数据传出设备、且开发者或其合作方能在实时处理之外继续访问），我们不满足条件，因此**不勾选音频数据**——这也是绝大多数用 `SFSpeechRecognizer` 的 App 的做法。

⚠️ **但线上隐私政策目前那句话是错的，提交前必须先改**：代码里**没有设置 `onDevice: true`**，`SpeechListenOptions` 用的是默认值（false），iOS 系统**可能把音频送到 Apple 的服务器**做识别，而政策原文写的是「在您的设备本地转换为文字」。
这不影响本节「不勾选音频数据」的结论（音频到的是苹果，不是我们），但政策措辞和这里的标签口径必须对齐。**改法和取舍见文末 ⚠️ 第 1 条。**

### 7.4 一个需要留意的申报特点

`Customer` 表里的姓名/电话/地址**是店主录入的第三方（他的客户）信息**，不是 App 用户本人的。苹果的标签体系里没有「第三方联系人」这一档，通行做法就是照常勾在「联系信息」里 —— 上表已经这么处理了。隐私政策里最好补一句：店主对其录入的客户信息负有告知义务。

---

## 8. 审核备注 Review Notes

### 中文版

```
一、这个 App 是做什么的
面向中国个体商户（小餐饮、水果店、便利店、酒水副食批发）的进销存记账工具。
核心场景：进货、卖货开单、库存、客户挂账要账、月底出报表和对账单。
免费 App，无内购，无广告，无第三方追踪 SDK。

二、审核演示账号
用户名：review
密码：ReviewDemo2026
（管理员角色，可以看到包括利润、资金流水在内的全部功能）
登录方式：在登录页直接用上面的账号密码即可。页面上的「通过 Apple 登录」是可选的第三方登录，不影响用演示账号审核。

三、建议的体验路径
0. 首次启动会先出现一张隐私政策同意页（中国大陆《个人信息保护法》合规要求）。点「同意并继续」即可进入登录页。
1. 登录后首页有「AI 口述记账」卡片，点麦克风说一句「卖了3箱啤酒280块」，或直接在输入框打字提交，即可看到 AI 解析出的确认单
2. 底部中间的「开单」是主功能：选商品、改价、选客户、收款
3. 「我的」页面里有报表中心、客户（欠款/对账）、AI 问生意、盘点单、导出数据等全部功能入口
4. 「我的 → 删除账号」是账号删除入口（两步确认 + 手动输入「删除」二字）

四、需要联网
App 的全部经营数据存放在我们的服务器（https://qxju.shop），需要网络连接。
服务器已部署在中国大陆，使用 HTTPS。

五、AI 功能依赖第三方服务
App 内共有五类 AI 功能：口述记账解析、AI 生成品类字段、AI 生成商品草案、粘贴文本批量导入商品、AI 问生意。
这些功能会把相关文本（用户口述或输入的内容、以及为回答问题所需的经营数据摘要，可能包含商品名和客户名）发送给第三方大模型服务商 DeepSeek（深度求索）进行解析，返回结构化结果。
这一点已在隐私政策中明确说明。用户不使用 AI 功能时，App 的全部记账功能仍可通过手工录入完整使用。

六、语音功能说明
语音输入使用 iOS 系统的 Speech 框架（SFSpeechRecognizer）转写为文字。
录音音频不会上传到我们的服务器，我们只接收转写后的文字，并把该文字发送给 DeepSeek 做语义解析。
注意：iOS 模拟器的语音识别栈不完整，模拟器上语音可能无法启动。App 对此有完整降级处理（会提示用户改用键盘输入），真机上正常。建议在真机测试语音功能。

七、其他
· 无内购。将来如对 AI 用量收费，会通过 App 内购买实现。
· 已包含 PrivacyInfo.xcprivacy，ITSAppUsesNonExemptEncryption 已声明为 false。
· 仅支持 iPhone（UIDeviceFamily = 1）。
· 中国大陆 App 备案号：【提交前填写】

如需任何补充材料或有疑问，请通过 App Store Connect 联系我们，会尽快回复。
```

### English version

```
1. What this app does
StockMate is an inventory-and-bookkeeping tool for small independent merchants in
mainland China (small restaurants, fruit stands, convenience stores, beverage and
grocery wholesalers). Core workflow: purchasing, sales invoicing, stock levels,
customer credit/receivables, and monthly reports and statements.
The app is free. No in-app purchases, no ads, no third-party tracking SDKs.

2. Demo account for review
Username: review
Password: ReviewDemo2026
(Administrator role — has access to every feature, including profit and cash-flow reports.)
Sign in with the username and password above on the login screen. The "Sign in with
Apple" button is an optional alternative login and is not required for review.

3. Suggested walkthrough
a. On first launch the app shows a privacy-policy consent screen (required for compliance
   with mainland China's Personal Information Protection Law). Tap the primary button
   ("同意并继续" / Agree and continue) to proceed to the login screen.
b. After login, the home screen shows an "AI voice bookkeeping" card. Tap the microphone
   and speak a sentence, or simply type into the text field and submit — the app returns a
   parsed draft entry for you to confirm.
c. The center tab at the bottom ("开单" / New Sale) is the primary feature: pick products,
   adjust prices, choose a customer, take payment.
d. The "我的" (Profile) tab contains the remaining features: reports, customers and
   receivables, AI business Q&A, stocktaking, and data export.
e. Account deletion is at "我的 → 删除账号" (two-step confirmation plus typing a
   confirmation word).

4. Network connection required
All business data is stored on our server (https://qxju.shop) over HTTPS. The server is
hosted in mainland China. An internet connection is required.

5. AI features rely on a third-party service
The app has five AI-assisted features — voice bookkeeping, AI-generated category fields,
AI-drafted product lists, bulk product import from pasted text, and AI business Q&A. They
send the relevant text (what the user dictated or typed, plus a summary of their own
business data needed to answer a question, which may include product and customer names)
to DeepSeek, a third-party large language model provider, and receive structured results.
This is disclosed in our privacy policy. Users who prefer not to use the AI features can
use the entire app through manual entry.

6. About the voice feature
Voice input is transcribed using Apple's own Speech framework (SFSpeechRecognizer). The
audio recording is never uploaded to our servers — we receive only the transcribed text,
which is then sent to DeepSeek for semantic parsing.
Please note: the iOS Simulator has an incomplete speech stack, so voice capture may fail
to start there. The app handles this gracefully (it prompts the user to type instead), and
it works normally on physical devices. We recommend testing voice on a real device.

7. Other notes
· No in-app purchases. If we later charge for AI usage, it will be implemented via
  In-App Purchase.
· PrivacyInfo.xcprivacy is included; ITSAppUsesNonExemptEncryption is set to false.
· iPhone only (UIDeviceFamily = 1).
· Mainland China ICP app filing number: [fill in before submission]

Please contact us through App Store Connect if you need anything further — we will respond
promptly.
```

---

## 9. 截图文案脚本（6 张）

截图规格：6.7"（1290×2796）必传，其余尺寸可由 6.7" 自动缩放。建议每张顶部压一句大字标题，下面放真机截图。

| # | 大字标题（≤8 字） | 拍哪个页面 | 截图前要准备什么 |
|---|---|---|---|
| 1 | **说一句话就记账** | 首页 Dashboard（`/`），要把「AI 口述记账」渐变卡拍进画面 | 账号里要有当天数据，让毛利大数字不是 0 |
| 2 | **记完先给你确认** | 语音口述结果确认页（`/voice-entry` 解析后的状态） | 造一句能同时解析出「进货 + 卖出 + 开销」的口述，三个分组都出现最有说服力 |
| 3 | **30秒配好你这行** | 品类管理 → 新建品类的「✨ AI 配字段」结果页（`/types`） | 用「水果店」或「馄饨店」当例子，比酒水更有普适感 |
| 4 | **开单收钱一屏搞定** | 开单页（`/orders/new`），购物车里有 2-3 行商品 | 带上客户名和一个折扣，让页面信息量看起来真实 |
| 5 | **谁欠多少一眼清** | 客户中心（`/customers`），顶部总欠款条 + 按欠款降序的列表 | 至少 5 个客户、金额有高有低，别全是整数 |
| 6 | **九张报表不用算** | 报表中心（`/reports`），滚到能同时看见 2-3 个报表区块的位置 | 选一个有数据的时间区间，空报表拍出来是减分项 |

**备选 2 张**（如果想替换上面某张，或后续做 A/B）：

| 大字标题 | 拍哪个页面 | 换掉谁 |
|---|---|---|
| **生意的事直接问** | AI 问生意（`/ask`），带一问一答 + 底部推荐问题 chips | 可替换第 3 张，如果想把 AI 心智打得更满 |
| **数据随时全导走** | 我的 → 导出全部数据弹窗（能看见「永远免费」字样） | 可替换第 6 张，如果想把「诚实」当主卖点 |

**排序理由：** 第 1、2 张决定 80% 的转化（App Store 列表页只露前两张）。所以第 1 张必须是差异化最大的语音入口，第 2 张紧接着回答用户看到语音后的第一反应——「AI 记错了怎么办」。第 3 张之后才是常规功能证明。

**大字标题的写法**：全用短句、动词开头、不带标点。别写「智能语音记账系统」这种词，小店主不认。

---

## ⚠️ 我不确定的地方（提交前需要人确认）

1. **【已确认是矛盾，必须修】线上隐私政策写的「设备本地转文字」，代码不支持这句话。**
   我把 `qxju.shop/stockmate/privacy` 的正文拉下来读了，原文是：

   > 语音输入：语音在您的设备本地转换为文字（使用 iOS 系统语音识别），**音频不会上传**；仅转换后的文字用于记账解析。

   但 `voice_entry_screen.dart:127-135` 的 `SpeechListenOptions` **没有设 `onDevice: true`**，用的是默认值 false —— iOS 在这个配置下**可以把音频送到 Apple 的服务器**做识别。
   拆开看：「音频不会上传（到我们的服务器）」是真的；「在您的设备本地转换」**不成立**。这是一句已经公开发布的、不准确的隐私声明。

   **二选一，提交前必须做一个：**
   - (A) 代码里加 `onDevice: true`——政策原文立刻变成真的，代价是中文长句识别准确率会掉，而口述记账恰恰全是长句，**我倾向不选这个**；
   - (B) 改隐私政策那一句，改成「语音由 iOS 系统语音识别转换为文字（该过程可能经由 Apple 的服务器完成）；**音频不会上传到我们的服务器**，我们只接收转换后的文字」。

   我在第 7、8 节里已经按 (B) 的口径写了审核备注和隐私标签。**如果最终选 (A)，第 8 节审核备注第六段要跟着改回「本地转写」。**

   顺带确认（这几条线上政策是对的，和我写的审核备注口径一致，不用动）：政策已点名披露第三方是「深度求索（DeepSeek）」✅、数据存中国境内腾讯云 ✅、明确不投广告/不做画像/不卖数据 ✅。

2. ~~**审核演示账号的数据太少，这是 2.1 拒审风险。**~~ ✅ **本轮已解决并复验通过，留档备查。**
   我最初拉生产数据时是：商品 2 个、订单 1 个、客户 2 个（两个都叫「老王烟酒行」，重复）、供应商 0、进货单 0、品类只有「酒水」1 个——审核员点进报表和对账基本全空，预审报告第 10 条就警告过「空账号审核员看不出功能」。
   `server/scripts/seed-demo.js` 已经写好并跑过了。**我重新连生产复验，现在是：品类 3 个（酒水/饮料/零食）、商品 20 个、销售单 33 张、进货单 10 张、客户 11 家（无重名，其中 5 家有欠款）、供应商 5 家。**
   重跑命令（改了数据想重来时用）：`env -u NODE_OPTIONS BASE=https://qxju.shop/mate-api/api/v1 node scripts/seed-demo.js`
   ⚠️ 唯一还需注意的：**截图和提审前再复验一次条数**。删号清店、换库、重新 `db push` 都会把这批数据清掉，而截图脚本第 4、5、6 张全依赖它。

3. **`PrivacyInfo.xcprivacy` 声明的数据类型比我给的隐私标签答案少。**
   文件里只声明了 `Name` 和 `OtherUserContent` 两类，而第 7 节我建议申报的还包括邮箱、电话、实际地址、用户 ID、照片。
   标签比清单声明得多，实践中不会直接拒审，但两边不一致不好看。**建议把 `EmailAddress` / `PhoneNumber` / `PhysicalAddress` / `UserID` / `PhotosorVideos` 补进 xcprivacy**，purpose 统一填 `AppFunctionality`。改完记得验产物：`ls build/ios/iphoneos/Runner.app/PrivacyInfo.xcprivacy`。

4. **「智存」这个名字有没有查过商标和 App Store 重名？** 我没查（不在我能力范围）。中国区 4.1/5.2 对名称冲突查得挺细，提交前最好在 App Store 搜一下「智存」，再上中国商标网查一下 9 类/42 类。

5. **描述里「免费额度永不回收」的口径。**
   这句话我是照搬 App 内「我的 → 我们的承诺」已经写死的三条（`profile_screen.dart:400-405`），所以商店页和 App 内是一致的。但这是**对未来的承诺**，任务 #13（AI 计费）还没做。
   一旦上线后要改定价模型，这句话会变成把柄。**要不要保留请老板拍板**——我倾向保留，因为它正是打智慧记「限 100 单」的最强武器，但你得知道自己签了什么。

6. **App 备案号还没有。** 审核备注里我留了「【提交前填写】」占位。CLAUDE.md 说备案在办，中国区提交是硬字段，没有号提交不了。

7. **技术支持入口在 App 里是缺的。** 「我的」页只有隐私政策和用户协议两个法务链接，没有指向 `qxju.shop/stockmate/support` 的入口。App Store Connect 的 Support URL 字段填上就满足要求，不影响过审；但用户在 App 内找不到反馈渠道，会直接去评论区发差评。**建议在「我的」页补一个「联系我们 / 技术支持」菜单项**，一行代码的事。
   （我读过线上支持页了，内容是齐的：上手、语音没反应、导出、删号、欠款五个 FAQ + 邮箱 `2917184410@qq.com`，承诺工作日 24 小时回复。**App Store Connect 里「技术支持网址」填 `https://qxju.shop/stockmate/support`、联系邮箱填这个 QQ 邮箱即可。**）
   小瑕疵：支持页开头那句「开单、欠款、报表一站式」用了「一站式」——正是我们在商店页文案里刻意避开的黑话。不影响审核，但两个页面调性最好统一，顺手改掉。

8. **蓝牙打印我写成了「能连蓝牙小票机打出来」，但它没经过真机 + 真打印机验证**（CLAUDE.md 明确标注「未用真机+真打印机验证过」）。
   代码是完整的（`core/printer_service.dart` + 设置页 `/printer`，扫描/连接/记住/自动重连/ESC-POS 光栅/测试打印全链路都在），所以不算虚构功能。但如果上线后打不出来，这条会变成差评源头。**要么提交前找台小票机实测，要么把描述里这半句删掉**（改成只说「单子能生成图片发微信」）。我先按保留写了。
   另外：实现**写死了 58mm / 384 点**（`printer_service.dart:11,20`、`printer_screen.dart:99`）。所以「支持蓝牙小票打印机」可以写，「支持各类打印机 / 80mm」不能写。

9. **描述里承诺的「旧账搬家」，入口藏得比较深——这条有点自打脸。**
   粘贴导入是真的（`type_edit_screen.dart:458` 调 `/ai/import-products`，`skipped` 也真的回传给用户看，「不假装全导进去了」这句站得住）。
   但它的入口在**品类编辑页**里，不在商品页。用户看完商店页描述、进 App 想搬数据，第一反应一定是去「商品」找，找不到。
   而我们拆解智慧记时，批评人家最狠的一条就是「AI 开单藏在三级入口」。**建议在商品页加一个「批量导入」入口指过去**，否则这条描述会变成差评理由（"说好的粘贴导入呢"）。不改的话描述这句也能留，只是要有心理准备。

10. **首启隐私同意页上那个「不同意并退出」按钮会调 `exit(0)`（`core/legal.dart:91`）——中等风险，建议改。**
    审核员一定会看到这一屏（我已经写进审核备注第三节，让他知道点哪个按钮）。风险在于：苹果一贯不喜欢 App 主动自杀，`exit(0)` 在用户眼里和闪退没区别，历史上有因此被判 2.1 / 设计问题的案例。
    中国区几乎所有 App 都有这道合规同意门，苹果对这个场景通常是放行的，所以**我不认为它会导致拒审，但它是这次提交里我唯一不敢打包票的交互**。
    成本很低的改法：把「不同意并退出」换成「暂不同意」，点了就停在这一屏并说明「需要同意后才能使用」，不调 `exit(0)`。合规效果一样，风险归零。

11. **App 端「AI 问生意」其实没有多轮上下文——CLAUDE.md 记的和代码不一致。**
    后端 `/ai/ask` 支持 `history`（`ai.js:208-219`，最近 3 轮），但 App 只发 `{'question': question}`（`ask_screen.dart:38`），从不回传历史。**多轮追问在 App 端等于没接。**
    我的描述里没写「能追问 / 记得上文」，所以商店页是安全的。但这是个真实的功能缺口，**别在后续文案或客服话术里说「可以接着追问」**。要不要补这条接线，是产品决定，不影响提审。

12. **没写进描述但确实存在的功能**，是我主动砍的，怕描述太长冲淡重点，列出来供你决定要不要加回去。**如果要加，注意括号里的措辞红线：**
    - 客户专属价 / 上次成交价自动带出
    - 配方 BOM，卖成品自动扣原料（入口很深：商品 → 编辑 → 规格行图标，无菜单无引导。**别写「一键设配方」，也别当首屏卖点**）
    - 通知中心 + 库存预警（首页铃铛红点，**纯本地聚合、零推送能力**——全项目无 firebase / flutter_local_notifications / APNs。**禁用「推送提醒」「自动通知你」「到货提醒」**，安全说法是「打开 App 就看到该催的账、该补的货」）
    - 独立出入库（报损/自用）
    - 进货单据照片识别（**是从相册选图，不调相机**——`ImageSource.gallery`，`purchase_order_create_screen.dart:108`、`voice_entry_screen.dart:165`。App 内那个按钮叫「拍单据」其实已经有点误导了，**文案要写「截图/照片识别」不能写「拍照识别」**）
    - Web 管理端（「电脑上还能用浏览器打开管理后台」是个不小的加分项，但我不确定 Web 端的上线域名和对外开放状态，所以没敢写）

13. **收支记账在 App 里没有独立的浏览/编辑页面**，只有三个写入口（首页「日结快录」、语音记账的开销/汇总、报损自动生成损耗），只读呈现仅在报表「资金流水」卡（仅老板）和导出的 CSV 里。
    我的描述里没有把「记一笔支出」当独立功能写，所以商店页没问题。**但别在截图或后续文案里出现「收支明细」这种暗示有专门页面的说法。**

---

✅ 已完成且真测：
- 三份事实源文档全文读完；`app/lib/features/` 全部 17 个页面文件逐一 grep 核实
- 描述里每条功能都有代码依据：9 张报表名称（`reports_screen.dart` 逐个 SectionTitle 核对）、底栏五个 tab（`app_shell.dart:32-38`）、首页麦克风卡（`dashboard_screen.dart:207-224`）、AI 问生意的自由输入框和推荐问题（`ask_screen.dart:20,121`）、导出/删号/员工管理/承诺页（`profile_screen.dart` 菜单项全表）、登录页只渲染 Apple 一个第三方按钮（`login_screen.dart:177-185`，微信华为确为注释）
- 演示账号 review/ReviewDemo2026 **真连生产环境登录成功**，前后两次实测商品/订单/客户/供应商/进货单/品类的真实条数（种子脚本跑前 vs 跑后），并复查了客户重名和欠款分布（见 ⚠️ 第 2 条）
- 隐私页/用户协议/支持页三个 URL 真 curl，全部 200；**隐私政策和技术支持两页的正文全文读过**，和商店页文案逐条对了口径（结果：DeepSeek 披露、境内存储、无广告三条一致；语音那句矛盾，见 ⚠️ 第 1 条）
- 无追踪 SDK 的结论来自 `pubspec.yaml` 21 个依赖逐个看过，不是推测
- 「不做多店多仓/收银台/会员积分/订货商城」这句经**双重核验**：23 张表的 schema 无对应模型 + 全 App dart 文件 grep 仅命中 1 条无关注释（`order_create_screen.dart:818` 提交订单的「收银的"叮"感」触感反馈）
- 所有长度受限字段用脚本对文件实测：名称 8/30、副标题 14/30、关键词 96/100、推广文本 77/170、描述 1442/4000、截图标题全部 ≤8 字

⚠️ 缩水的地方：
- **我在描述里写过一句吹牛的话，被交叉核查抓出来了，已改。** 原文写「断网的时候商品、客户还能查得到」——实际上带缓存的 `productsProvider` 只服务开单/进货的**选货弹窗**，商品 Tab 页面走的是无缓存的 `productListProvider`（`providers.dart:143-190`），所以「断网能翻商品库存页」是假的。已改成「断网时开单页里挑货、翻客户和供应商还能读到上次的数据」。
  **这条记一笔**：我当时是从 CLAUDE.md 的「types/products/customers/suppliers 走 `_cachedList`」直接推的结论，没往下追一层看这个 provider 到底被哪个页面用。**文档里的一句话 ≠ 用户能看到的行为**，以后核实"断网/降级"这类声明必须追到消费方。
- **关键词字数我第一遍是手算的，算错了**（写成 97，实测 93），已改用脚本重测并补词到 96/100。用心算冒充测量，同样记一笔。
- **没有查「智存」的商标和 App Store 重名**（原因：需要外部商标库和商店检索，超出我能确认的范围）。已列进 ⚠️ 第 4 条。
- **没有真机抓包验证语音音频是否真的走了 Apple 服务器**（原因：需要真机 + 抓包，模拟器语音栈不完整跑不了）。我只确认了 `onDevice` 未设置、默认为 false，据此推断系统「可能」上传音频。这是全文唯一一处基于「API 默认值语义」而非实际观测的结论——但结论方向是保守的（宁可承认可能上传），所以 ⚠️ 第 1 条的建议 (B) 不受这个不确定性影响。
- **截图文案是脚本，不是成品**：第 9 节给的是每张拍哪一页、标题写什么，实际截图和排版要人来做，我没法验证真机上那些页面的数据长得好不好看。
