# Web 端原型还原规格 + 接口形状（agent team 侦察产出 2026-08-06）

> 用途：web/ 模块 2-5 开发时的精确参照。原型源文件在 ~/Downloads/browser/stitch_smart_ai_inventory_hub 2/。
> 圆角口径已定死（见 web/src/theme.ts）：卡 24 / 导航 32 / 小控件 12 / 按钮 999。

# Aetheric Dashboard 原型精确还原规格（从源码抠值，非目测）

事实源：
- `/Users/carey/Downloads/browser/stitch_smart_ai_inventory_hub 2/_3/code.html`（总览 dashboard）
- `/Users/carey/Downloads/browser/stitch_smart_ai_inventory_hub 2/_1/code.html`（数据分析）
- `/Users/carey/Downloads/browser/stitch_smart_ai_inventory_hub 2/_2/code.html`（库存表格）
- `/Users/carey/Downloads/browser/stitch_smart_ai_inventory_hub 2/aetheric_dashboard/DESIGN.md`（令牌）

## 0. 全局令牌（三个页面 tailwind config 完全一致）

**颜色**（M3 命名，全部实测值）：
- primary `#4648d4` / on-primary `#ffffff` / primary-container `#6063ee` / primary-fixed `#e1e0ff` / primary-fixed-dim `#c0c1ff`
- secondary `#516072`（次要文字/图标主色）/ secondary-fixed-dim `#b9c8de`（图表第二条线）
- background = surface = surface-bright `#f9f9ff`；surface-container-low `#f0f3ff`；surface-container `#e7eeff`；surface-container-high `#dee8ff`；surface-container-highest = surface-variant `#d8e3fb`；surface-dim `#cfdaf2`
- on-surface = on-background `#111c2d`；on-surface-variant `#464554`
- inverse-surface `#263143`（深色 tooltip 底）/ inverse-on-surface `#ecf1ff`
- outline `#767586`；outline-variant `#c7c4d7`（边框主力，常用 /30 /40 /50 透明度）
- error `#ba1a1a` / error-container `#ffdad6`
- 语义绿不在令牌里，直接用 Tailwind emerald-500 `#10b981`；偏低警示用 orange-500 `#f97316`

**圆角（⚠️ 命名陷阱）**：config 覆写了 Tailwind 默认——`rounded`=16px、`rounded-lg`=**32px**、`rounded-xl`=**48px**、`rounded-full`=9999px。所以源码里所有卡片的 `rounded-xl` 实际是 48px（大尺寸卡上视觉≈超软圆角），DESIGN.md 散文里说"卡片最小 24px"与 config 不一致。**照抄源码就用：卡片 48px（rounded-xl）、导航项/图片位 32px 或 16px、右栏 profile 卡显式 `rounded-[2rem]`=32px。** 若你要折中，DESIGN.md 的 md=24px 是官方"24px 卡"出处。

**间距令牌**：sidebar-width `260px`；right-panel-width `320px`（⚠️ _1 页是 340px，其余两页 320px，以 320 为准）；gutter `24px`（_1 是 32px）；container-padding `32px`；card-gap `20px`（_1 是 24px）。

**阴影/玻璃（三套，反复出现）**：
- `.glass-card`（_3/_2 卡片标准）：`background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); border: 1px solid rgba(226,232,240,0.8)`（_2 里是实色 `#e2e8f0`）`; box-shadow: 0 4px 24px rgba(99,102,241,0.05)`（_2 变体 `0 4px 24px -6px rgba(99,102,241,0.05)`）
- `.soft-shadow` / `.ambient-shadow`：`box-shadow: 0 10px 40px -10px rgba(70,72,212,0.08)`（_2 用的是 rgba(99,102,241,0.08)，同级）
- `.glass-panel`（浮层/图表 tooltip 玻璃款）：`background: rgba(255,255,255,0.7); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.5)`
- 主按钮 hover 光晕：`box-shadow: 0 0 15px rgba(70,72,212,0.4)`；或 `shadow-sm shadow-primary/20`

**滚动条**：宽/高 6px，track 透明，thumb `#d8e3fb` 圆角 10px，hover `#b9c8de`（_2 用 `#c0c1ff`）。

**氛围光（_1）**：主区右上角绝对定位 500×500px 圆，`bg primary/5` + `blur(100px)`，-z-10。

## 1. 三栏布局骨架

`body`：`display:flex; height:100vh; overflow:hidden;` 背景 `#f9f9ff`，文字 `#111c2d`，antialiased。

**侧栏 `<aside>`**：宽 260px 固定（shrink-0），`height:100vh`，背景 surface-bright `#f9f9ff`，右边框 `1px solid #c7c4d7`，内边距 `padding: 24px 16px`（py-gutter px-4）。结构自上而下：
1. Logo 区：`flex items-center gap:12px; margin-bottom:40px; padding: 0 8px`（_2/_1 用 8×8 圆角方块 logo：32×32px、圆角 8px、bg primary、白色填充图标 20px）。_3 直接用 30px 主色填充图标。标题「智库系统」headline-md 20px/28px w700 主色；副标「智能库存管理」label-sm 12px/16px w500 secondary。
2. 导航 `nav`：`flex:1`，项间距 `8px`（space-y-2；_2 是 4px）。
3. 底部 `margin-top:auto`，间距 24px：升级 CTA 卡 + 帮助中心/退出登录。
   - CTA 卡：bg `#f0f3ff`，圆角 48px（rounded-xl；_1 用 rounded-2xl=Tailwind 默认16px？——⚠️ config 未定义 2xl，Tailwind 默认 1rem=16px 生效），padding 20px，居中。标题 label-md bold mb-8px，描述 label-sm secondary mb-16px，按钮 `width:100%; padding:8px 0; rounded-full; bg rgba(96,99,238,0.2)`（primary-container/20）文字主色 label-md，hover /30。
   - 帮助中心/退出登录：`flex gap:12px; padding:8px 16px;` label-md，色 secondary；hover 帮助→primary、退出→error `#ba1a1a`；transition-colors。

**主区 `<main>`**：`flex:1; min-width:0; display:flex; flex-direction:column; overflow:hidden;` 背景 `#f9f9ff`。顶栏固定 80px 高，其下滚动容器 `flex:1; overflow-y:auto; padding: 0 32px 32px`（px/pb-container-padding）。

**右栏 `<aside>`**：宽 320px 固定，`height:100vh; overflow-y:auto`。两种做法：
- _3：背景与主区同色 `#f9f9ff`，左边框 `1px solid rgba(199,196,215,0.3)`，`padding: 24px 24px`（py-gutter px-6）。
- _1：纯白底 `#ffffff`，左边框 `1px solid #c7c4d7`，自带投影 `box-shadow: -10px 0 30px -15px rgba(0,0,0,0.05)`，内部分区各自 padding（profile 区 p-32px + border-b，动态区 p-24px，底部输入 p-16px + border-t）。
- _2：右栏不是独立 aside，而是滚动画布内的 320px 列，`flex-col gap:24px`。

## 2. 导航项（重点：激活态左侧造型）

**答案：是元素自身的 `border-left: 4px solid #4648d4` 竖条**，不是半圆缺口、不是独立指示条。竖条高度=整个导航项高度（padding 12px×2 + 18px 行高 ≈ 42px），因为项本身带 32px 圆角（rounded-lg），竖条上下端随圆角被裁弯。**未激活项必须带 `border-left: 4px solid transparent` 占位**，否则激活切换时文字会横跳 4px。

- 默认态：`display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:32px`（_1 用 rounded-xl=48px，_2/_3 用 rounded-lg=32px，取 32px）；图标 Material Symbols Outlined 24px；文字 label-md（13px/18px，letter-spacing 0.05em，w600）；颜色 secondary `#516072`；`border-left:4px solid transparent`。另有 `scale-95`（transform 缩到 0.95，_3/_2 常驻）。
- hover：文字/图标变 primary，背景 `#f0f3ff`（surface-container-low），`transition-colors 200ms`。
- 激活态：文字 primary `#4648d4` + `font-weight:700`；背景 `rgba(96,99,238,0.10)`（primary-container/10，实际渲染≈极淡靛蓝）；`border-left:4px solid #4648d4`；图标可用填充版（`font-variation-settings:'FILL' 1`，_2 的激活项就是填充图标）。
- _3 里「库存管理/智能录入」项尾部还有 `margin-left:auto` 的 14px `add` 小图标（快捷入口）。

## 3. 顶栏（TopAppBar）

高 80px（h-20），`padding: 0 32px`，`display:flex; justify-content:space-between; align-items:center;` 背景：`rgba(249,249,255,0.8)` + `backdrop-blur(24px)`（⚠️ _3/_2 同时挂了 `bg-transparent`，类冲突，视觉上因页面同底色无差别；实现取半透明+blur 即可），无阴影，z-10，shrink-0。

- **页面标题**：headline-xl 30px/38px w700 letter-spacing -0.02em，色 on-background `#111c2d`。
- **搜索框（_2）**：`flex:1; max-width:448px（max-w-md）; margin-left:32px; margin-right:auto;` 相对定位。放大镜图标绝对定位 left:16px 垂直居中，色 secondary，容器 focus-within 时变 primary。input：`background:#f8fafc; border:none; border-radius:9999px; padding:10px 16px 10px 44px;` 14px 字，placeholder secondary；focus：`ring 2px rgba(70,72,212,0.3)`，transition 300ms。
- **铃铛/齿轮**：图标按钮。_3 版 `padding:8px; border-radius:9999px`；_2 版固定 `40×40px 圆形 flex居中`。图标 24px，色 on-surface-variant `#464554`（_2 用 secondary）；hover 背景 `#dee8ff`（surface-container-high）；focus ring 2px primary。_2 里这组与主按钮之间用 `border-left:1px solid #c7c4d7; padding-left:24px` 分隔，组内 gap 8px。
- **「导出报表」主按钮**：药丸。_3 版：`background:#4648d4; color:#fff;` label-md，`padding:8px 24px; border-radius:9999px;` hover `box-shadow:0 0 15px rgba(70,72,212,0.4)`。_2 版：`padding:10px 20px` + 20px download 图标 gap-8px + `shadow-sm shadow-primary/20`，hover 背景变 primary-container `#6063ee`。_1 还有 ghost 变体：白底 + `border:1px solid #c7c4d7` + `border-radius:12px（rounded-xl 语义下实为48px，_1 视觉近 12-16px，照 config 是 48px——按钮矮所以视觉自动钳制为胶囊）` + shadow-sm。
- **头像**：40×40px 圆形，overflow-hidden，`border:1px solid #c7c4d7`，`margin-left:8px`，img object-cover。
- 排布：右侧整体 `gap:16px`（_2 gap:24px）。
- **分段切换器（_1 顶栏）**：外壳白底 `border-radius:12px~（rounded-xl）; padding:4px; border:1px solid rgba(199,196,215,0.5); shadow-sm`；每段 `padding:6px 16px; border-radius:8px（rounded-lg）`；激活段 bg `#f0f3ff` 文字 primary；未激活 secondary，hover bg surface-bright。

## 4. 指标卡（stat card）

**_3 总览版**（3 列 grid，gap 20px，区块下边距 32px）：
- 容器：glass-card + `border-radius:48px（rounded-xl）; padding:24px;` `flex items-center justify-between`。中间那张额外 `border-left:4px solid rgba(70,72,212,0.2)`。
- 图标圆片：`48×48px（w-12 h-12）; border-radius:9999px; background:#dee8ff（surface-container-high）;` 内 24px Material 图标，色 primary。与文字组 gap 16px。
- 标签：label-sm 12px/16px w500，色 secondary，`margin-bottom:4px`。
- 大数字：headline-lg 24px/32px + font-bold（**实际 700**，class 覆盖了令牌里的 600），色 on-surface。
- 趋势：**不是带底色的 chip，是裸彩色文字**。label-sm 12px，与数字底对齐（`flex items-end gap:8px`，趋势字 `margin-bottom:4px`）。正向绿 emerald-500 `#10b981`（源码写「▼ +8%」「▼ +12%」——⚠️ 原型箭头方向与正负号自相矛盾，实现时应改为 ▲配+、▼配-）；负向红 error `#ba1a1a`（「▲ -6 相比昨日」同病）。
**_1 分析版**：白底卡 `border:1px solid rgba(199,196,215,0.5)` + soft-shadow + padding 24px；文字在左（标签用 label-md 13px、mb-8px；数字 headline-lg bold；趋势带 14px `arrow_upward` 图标）、图标圆片在右：48px 圆、底色按语义 `rgba(70,72,212,0.1)`（primary/10）/ `rgba(186,26,26,0.1)`（error/10）/ `rgba(81,96,114,0.1)`（secondary/10），图标同色。
**_2 表格页版**：4 列 grid gap 16px；卡 padding 20px（p-5）；图标圆片底色 `rgba(225,224,255,0.3)`（primary-fixed/30）或 `rgba(255,218,214,0.5)`（error-container/50）或 `#dee8ff`；数字用 headline-md 20px；图标一律填充版（FILL 1）。

## 5. 折线图卡

**容器（_3）**：glass-card，圆角 48px，padding 24px，`margin-bottom:32px; position:relative; overflow:hidden`。头部 `justify-between mb-24px`：标题 headline-md 20px/28px bold；**日期胶囊按钮**：`flex gap:8px; padding:6px 12px; border-radius:9999px; background:#e7eeff（surface-container）;` hover `#dee8ff`；label-sm 文字 + 14px `expand_more` 图标。

**绘图区**：高 256px（h-64），整块叠 `.chart-gradient` 底：`linear-gradient(180deg, rgba(70,72,212,0.1) 0%, rgba(70,72,212,0) 100%)`，圆角 32px（rounded-lg），`margin-top:16px`。
- SVG：`viewBox="0 0 800 200"; preserveAspectRatio="none"; position:absolute; inset:0`。
- 网格线：水平三条（y=50/100/150），`stroke:#e2e8f0; stroke-dasharray:4 4`。（_1 变体：4 条 `border-bottom:1px solid rgba(199,196,215,0.3)` 的 div。）
- 主线：`stroke:#4648d4; stroke-width:3; stroke-linecap:round; stroke-linejoin:round; fill:none`，三次贝塞尔平滑。_1 版主线加发光：`filter: drop-shadow(0 8px 6px rgba(70,72,212,0.2))`。
- 副线（上月/入库）：`stroke:#b9c8de（secondary-fixed-dim）; stroke-width:2`。_1 用 `#d8e3fb`。
- 高亮数据点：`circle r=5; fill:#ffffff; stroke:#4648d4; stroke-width:3`；点下垂直虚线 `stroke:#4648d4; stroke-dasharray:4 4`（_1 用 `#c7c4d7` dasharray 2 2）。
- X 轴标签：绝对定位贴底一行 `justify-between; padding:0 16px`，label-sm 12px secondary；卡内底部留 32px spacer。

**Tooltip（深色卡，_3）**：绝对定位在数据点上方，`transform:translateX(-50%)`；`background:#263143（inverse-surface）; color:#ecf1ff（inverse-on-surface）; border-radius:32px?（rounded-lg=32px，视觉按小卡钳制）; padding:12px; width:160px; box-shadow:shadow-lg; border:1px solid rgba(255,255,255,0.1); backdrop-blur(12px)`。第一行日期 label-sm、opacity 0.8、mb-8px；数据行 `justify-between` label-md，行首图例竖条 `4×12px（w-1 h-3）圆角 full`，本月 `#4648d4`、上月 `#b9c8de`。
**Tooltip 玻璃版（_1）**：`.glass-panel`（白 70% + blur20 + 白边 50%）+ `border-radius（rounded-xl）; padding:12px; min-width:120px; shadow-lg`；数值 label-md bold 主色/次色。

**环形图（_1 品类分布）**：SVG `viewBox 0 0 36 36` 旋转 -90°，容器 192×192px（w-48）；`r=15.915; stroke-width:6; fill:transparent`；底圈 `#f0f3ff`；分段用 `stroke-dasharray "45 55"/"30 70"/"15 85"` + `stroke-dashoffset 0/-45/-75`，色 `#4648d4`/`#b9c8de`/`#727577`。中心叠字：label-sm secondary +headline-lg bold。图例行：12px 圆点 + label-sm + 右侧百分比 label-sm bold，行距 8px。

## 6. 右栏卡片

**_2「快速操作」**：glass-card + ambient-shadow，圆角 48px（rounded-xl），padding 24px。标题 headline-md，mb-16px。⚠️ 澄清：**两个按钮不是正圆，是 2 列 grid（gap 12px）的圆角方卡按钮**：`flex-col 居中 gap:8px; padding:16px; border-radius:48px（rounded-xl，实测视觉大圆角方块）; border:1px solid #c7c4d7; background:transparent`；内容 28px 图标 + label-sm 文字，均 secondary；hover：`border-color:#4648d4; background:rgba(225,224,255,0.1)（primary-fixed/10）`，图标文字变 primary，transition-colors。

**_2「最近动态」时间线**：glass-card 圆角 48px padding 24px，`flex:1` 撑满剩余高。标题 headline-md mb-24px。列表 `space-y-24px`，内部滚动 `pr-8px`。每条：
- `position:relative; padding-left:24px`。
- 连接线：`absolute; left:6px; top:8px; bottom:-24px; width:1px; background:#c7c4d7`（最后一条不画）。
- 圆点：`absolute; left:0; top:6px; 12×12px; border-radius:9999px; border:2px solid #ffffff;` 底色按语义 primary `#4648d4` / error `#ba1a1a` / 绿 `#10b981`，并带同色柔影 `shadow-sm shadow-{color}/30`。
- 时间：label-sm 12px secondary，`margin-bottom:4px`。
- 文案：body-md 14px/20px on-surface；人名 `font-weight:500`；**高亮链接**（单号）`color:#4648d4; hover:underline; cursor:pointer`；SKU 代码 `font-mono 14px; background:#e7eeff; padding:0 4px; border-radius:4px`；告警前缀 `font-weight:500; color:#ba1a1a`。

**_3 Profile 卡**：bg `#f0f3ff`，**显式 `border-radius:2rem（32px）`**，padding 32px，居中排版，`border:1px solid rgba(199,196,215,0.2); shadow-sm`。右上装饰光斑：128×128px 圆、`bg rgba(70,72,212,0.1)`、`blur-3xl`、右上溢出 -40px。头像 96×96px 圆、`border:4px solid #fff; shadow-md`；在线点 16×16px emerald-500、白边 2px。姓名 headline-md bold；@handle label-sm secondary mb-24px。三个操作圆钮：**48×48px 正圆、白底、shadow-sm**，图标 secondary；hover 图标变 primary + shadow-md，gap 16px。（_1 变体：40×40px、透明底+`1px #c7c4d7` 描边，hover 描边和图标变 primary。）

**_3 活动流**：条目 `flex gap:16px`；头像 40px 圆；名字 label-md bold 与时间 label-sm secondary 两端对齐；正文 body-md secondary；引用气泡 `background:#f0f3ff; padding:12px; border-radius:（rounded-xl）+ 左上角切平（rounded-tl-none）`；文件附件条 `bg #f0f3ff; padding:12px; 圆角 xl; border:1px solid rgba(199,196,215,0.3)`，hover 边框 `rgba(70,72,212,0.3)`；文件图标位 32×32px、圆角 4px、bg `#263143`、白图标；下载钮 `color:primary; hover bg rgba(70,72,212,0.1); padding:6px; 圆形`。
**底部消息输入（_3）**：`margin-top:16px; padding-top:16px; border-top:1px solid rgba(199,196,215,0.3)`；胶囊容器 `bg #f0f3ff; border-radius:9999px; padding:8px 16px; border:1px solid rgba(199,196,215,0.5)`；focus-within：`border-color:#4648d4 + ring 2px rgba(70,72,212,0.2)`。（_1 版 AI 输入：白底胶囊 `padding:10px 40px; border:1px solid #c7c4d7; shadow-sm`，左 `smart_toy` 图标、右主色 send 钮，focus ring `rgba(70,72,212,0.5)`。）

## 7. 字体

- 字族：`Manrope`（Google Fonts，载入 400/500/600/700 四档），`body { font-family:'Manrope', sans-serif }`。图标字体：Material Symbols Outlined（可变轴 wght 100-700 + FILL 0/1；填充图标用 `font-variation-settings:'FILL' 1`）。
- 字阶（唯一事实源，三页一致）：
  - headline-xl：30px / 38px / w700 / -0.02em（页面大标题、问候语）
  - headline-lg：24px / 32px / w600（指标大数字，实际都叠了 font-bold→700）
  - headline-md：20px / 28px / w600（卡片标题、侧栏 logo 字，常叠 bold）
  - body-lg：16px / 24px / w400（原型中几乎未用）
  - body-md：14px / 20px / w400（正文、表格单元格）
  - label-md：13px / 18px / w600 / +0.05em（导航项、按钮、tooltip 行）
  - label-sm：12px / 16px / w500（标签、时间戳、图例、表头）
- ⚠️ Manrope 无 CJK 字形，中文全部回退系统字体。按 StockMate 设计语言既有铁律：**中文回退 PingFang SC，字重封顶 w700**（w800 会致个别汉字渲染异常）——建议 `font-family:'Manrope','PingFang SC',sans-serif`，letter-spacing 0.05em 的 label 档对中文可酌情归零（原型未处理）。

## 8. 反复出现的细节汇总

- **卡片边框**：玻璃卡 `1px rgba(226,232,240,0.8)` 或实色 `#e2e8f0`（slate-200，不在 M3 令牌里，是 Stitch 混入的 Tailwind 默认色）；白卡 `1px rgba(199,196,215,0.5)`（outline-variant/50）。分隔线一律 outline-variant 加 /30~/50 透明度。
- **阴影三档**：卡片 `0 4px 24px rgba(99,102,241,0.05)`；强调卡 `0 10px 40px -10px rgba(70,72,212,0.08)`；主按钮 hover `0 0 15px rgba(70,72,212,0.4)` 或 `shadow-sm shadow-primary/20`。全部靛蓝染色，无中性灰影。
- **hover 语法**：列表行/任务卡 hover 背景 `#f0f3ff`（或 /50）；行内操作按钮 `opacity:0 → group-hover opacity:100`（表格行编辑/补货、任务卡 more 按钮都是这个模式）；一切 transition-colors 200ms。
- **日期/筛选胶囊**：`padding:6px 12px; rounded-full; bg #e7eeff; hover #dee8ff; label-sm`（+14px expand_more）。顶部日期胶囊用 glass-card 版：`px-16 py-8 rounded-full label-md` + 18px calendar_today。
- **状态点语法**：圆点+文字。表格状态 `8px（w-2 h-2）` 点：充足 `#10b981`、预警 `#ba1a1a`（整行还叠 `bg rgba(255,218,214,0.1)`，库存数字标红）、偏低 `#f97316`；任务状态点同 8px：进行中 amber-500 `#f59e0b`、挂起 blue-500 `#3b82f6`、已完成 emerald-500。
- **分类 chip（表格）**：`padding:4px 10px; rounded-full; background:#d8e3fb（surface-variant）; color:#464554; 11px`。
- **表格**：th `padding:12px 20px` label-sm secondary w500，thead `sticky; bg rgba(255,255,255,0.95); backdrop-blur; border-bottom outline-variant`；td `padding:12px 20px` body-md；行分隔 `divide-y rgba(199,196,215,0.5)`；商品图 40px 圆角 8px；SKU 列 `font-mono 14px` secondary；筛选 tab 药丸激活态 `bg #f0f3ff text-primary`；「新增商品」`bg rgba(70,72,212,0.1) text-primary bold rounded-full，hover /20`。
- **分页**：`32×32px（w-8 h-8）圆角 8px` 方钮，当前页 `bg #4648d4 text-white`，其余 hover `#f0f3ff`；容器 `padding:16px; border-top; bg rgba(255,255,255,0.5)`。
- **AI 建议行（_1）**：`padding:16px; rounded-xl; bg rgba(240,243,255,0.5)`，hover 变实色 + `border transparent→rgba(199,196,215,0.3)`；左 40px 语义色 /10 圆片图标；右侧按钮 ghost（白底描边 rounded-lg px-16 py-8 label-sm shadow-sm）或 primary 实底同尺寸。
- **激活项通用公式**：`文字/图标 primary + w700 + bg primary(-container)/10 + 左 4px primary 竖条`——侧栏、筛选 tab、分段器全家通用（后两者省掉竖条）。

---
✅ 已完成且真测：三个 HTML 源文件与 DESIGN.md 全文逐行读过，以上所有数值（颜色/圆角映射/间距/阴影/字阶/透明度）均直接摘自源码 class 与 config，Tailwind 类已按该 config 的覆写值换算（关键坑：rounded-lg=32px、rounded-xl=48px）。
⚠️ 缩水的地方：
- 未做浏览器渲染核对（本任务只要求读源码抠值）。个别类冲突处（header 同挂 `bg-surface/80` 与 `bg-transparent`、_1 的 rounded-2xl 未在 config 定义）以源码事实标注了 ⚠️，最终视觉以实现后截图核对为准。
- 原型自身的箭头/正负号矛盾（▼+8%）与 _1 页 340px 右栏、32px gutter 的口径分歧，按"_3 为主"给了取舍建议，非原样两存。
本轮归档：无（子代理环境，vault 不在职责范围；规格已全文返回给父任务）。

---

# StockMate 后端接口侦察报告（Web 管理端 dashboard 用）

基础信息（全部真调验证于 2026-08-06，本地 localhost:3100）：
- Base URL：`http://localhost:3100/api/v1`
- 认证：`POST /auth/login` body `{"username":"admin","password":"admin123"}` → `data.token`；后续请求带 `Authorization: Bearer <token>`
- 统一响应包裹：`{"code":200,"message":"success","data":...}`，业务数据全在 `data` 里
- 分页接口统一形状：`data.list` + `data.pagination:{page,pageSize,total,totalPages}`（均为数字）

---

## 1. GET /stats/overview — 今日看板

- 参数：无
- 源码：`server/src/controllers/stats.js` L8-70

真实响应：
```json
{"code":200,"message":"success","data":{
  "todaySales":60,"todayOrderCount":4,"todayExpenses":0,
  "todayCogs":60,"todayProfit":0,
  "profitUnreliable":false,"noCostSales":0,"noCostProductNames":[],
  "lowStockCount":0,"productCount":18}}
```

映射建议：指标卡直接用 todaySales/todayOrderCount/todayProfit/lowStockCount/productCount。`profitUnreliable=true` 时毛利卡必须带提示「其中 ¥{noCostSales} 的货没填进价（{noCostProductNames.join('、')}…）」——这是项目铁律5，Web 端不能省。

---

## 2. GET /stats/sales — 折线图数据源

- 参数：只有 `days`（默认 7，上限 90，`Math.min(days, 90)`）。**没有** startDate/endDate、没有粒度参数——固定按日聚合，只统计 status=completed 的订单 actualAmount。
- 源码：stats.js L73-98

真实响应（`?days=7`）：
```json
{"code":200,"message":"success","data":[
  {"date":"2026-07-30","sales":0,"orders":0},
  {"date":"2026-08-02","sales":605.4,"orders":6},
  {"date":"2026-08-05","sales":30,"orders":2}]}
```

映射建议：data 就是长度=days 的数组，零天已补齐，直接喂折线图（x=date, y=sales，副轴/tooltip 用 orders）。想做 7/30/90 天切换就传不同 days。
⚠️ 坑：日期 key 用 `toISOString().slice(0,10)` 生成，是 **UTC 日期**。本地是 UTC+8，今天（本地 8-06）上午的单被归到 8-05/8-06 取决于 UTC 时刻——真调时 overview 显示今天 4 单，但 sales 数组最后一天是 8-05（今天 UTC 日尚未有单落在数组窗口末尾，且今日早上的单 UTC 时间是 08-06T02:33 落进 8-06 但 days=7 窗口起点也按 UTC 算）。前端画图直接用返回的 date 字符串即可，别自己按本地"今天"去对齐 overview 的今日数，两者口径有 8 小时错位。

---

## 3. GET /inventory/records — 出入库流水（右栏动态主数据源）

- 参数：`page`(默认1) `pageSize`(默认20) `productId` `skuId` `type`（type 取值如 `outbound`/`inbound`/adjust 类）
- 排序：id 倒序（最新在前）
- 源码：`server/src/controllers/inventory.js` L154-175

真实响应（截断为 1 个元素）：
```json
{"data":{"list":[{
  "id":93,"productId":5,"skuId":5,"type":"outbound","quantity":1,
  "beforeQuantity":45,"afterQuantity":44,
  "reason":"销售单 SO20260806004",
  "relatedOrderId":27,"relatedPurchaseOrderId":null,
  "operatorId":1,"createdAt":"2026-08-06T02:33:52.144Z",
  "product":{"id":5,"name":"芹菜馄饨","unit":"盒","code":"P42244646", "...":"完整 Product 行"},
  "sku":{"id":5,"specValues":"{}","specText":"","price":15,"isDefault":1,"...":"完整 Sku 行"},
  "operator":{"id":1,"realName":"管理员"}}],
 "pagination":{"page":1,"pageSize":2,"total":37,"totalPages":19}}}
```

映射建议：动态条目 = `{product.name}{sku.specText ? '('+sku.specText+')' : ''} {type==='outbound'?'-':'+'}{quantity}{product.unit}`，副文案用 `reason`，时间 `createdAt`（UTC ISO，前端转本地），操作人 `operator.realName`。注意 `sku.specValues` 在此接口是 **JSON 字符串未解码**（与 alerts 不同），要用就 JSON.parse；一般用 `specText` 就够。

---

## 4. GET /orders — 订单列表

- 参数：`page` `pageSize` `customerId` `status`(completed/cancelled…) `startDate` `endDate`(YYYY-MM-DD，endDate 含当天 23:59:59) `unpaidOnly=1`(只看欠款，会强制 status=completed)
- 排序：id 倒序
- 源码：`server/src/controllers/orders.js` L145-182

真实响应（截断为 1 个元素）：
```json
{"data":{"list":[{
  "id":27,"orderNo":"SO20260806004","customerId":2,"status":"completed",
  "totalAmount":15,"discountRate":null,"discountAmount":0,
  "actualAmount":15,"paidAmount":15,"unpaidAmount":0,
  "settlementAccount":null,"notes":null,"printedAt":null,
  "operatorId":1,"createdAt":"2026-08-06T02:33:52.143Z","updatedAt":"...",
  "customer":{"id":2,"name":"散客"},
  "_count":{"items":1}}],
 "pagination":{"page":1,"pageSize":2,"total":15,"totalPages":8}}}
```

映射建议：单号 `orderNo`、客户名 `customer.name`（散客也有名字，不会是 null，但 customer 理论上可空判一下）、金额 `actualAmount`、欠款 `unpaidAmount`（服务端已算好并四舍五入 2 位，>0 即欠款）、时间 `createdAt`、件数 `_count.items`。dashboard「最近订单」用 `?page=1&pageSize=5` 即可。

---

## 5. GET /inventory/alerts — 缺货预警清单

- 参数：无。规则：minQuantity>0 且 quantity<=minQuantity 的在售规格
- 源码：inventory.js L142-151

真实响应：当前库无缺货，`"data":[]`。data 是 **裸数组**（不分页）。每个元素形状（由源码确认）：Inventory 行 + `sku`（其中 `specValues` **已 JSON.parse 成对象**，还含 `sku.product` 完整商品）：
```json
[{"id":1,"skuId":5,"quantity":2,"minQuantity":10,"updatedAt":"...",
  "sku":{"id":5,"specText":"大/红","specValues":{"size":"大"},"price":15,
         "product":{"id":5,"name":"芹菜馄饨","unit":"盒","...":""}}}]
```

映射建议：预警条目 = `{sku.product.name} {sku.specText}`，展示 `quantity/minQuantity`。数量角标可以直接用 `data.length`，或省一次请求直接用 overview 的 `lowStockCount`（同口径）。注意此接口 specValues 是对象、records 接口是字符串——两处形状不一致。

---

## 6. POST /ai/ask — AI 问生意

- 请求体：`{"question": string(min 2), "history": [{"role":"user"|"assistant","content":string(max 2000)}]}`；history 可省略（默认 []），最多 6 条（即最近 3 轮）。字段名就叫 `question` 和 `history`。
- 权限：adminOnly（老板专属，staff 会被拒）
- 源码：`server/src/controllers/ai.js` L207-223；AI 未配置时抛 503

真调（问「今天卖了多少」）：
```json
{"code":200,"message":"success","data":{
  "question":"今天卖了多少",
  "answer":"今天订单数4单，具体销售额数据里没有，你可以去报表中心看今日流水。"}}
```

- 耗时：本次真调 1.16s（真 DeepSeek 调用，无本地 mock，命中了 DeepSeek 服务端 prompt cache 且回答短）。**典型耗时应按 2~15s 预算**（快照大、回答长、网络波动时更久），前端必须做 loading 态 + 建议 30s 超时提示。
- 映射建议：聊天 UI 每轮把 `{role:'user',content:question}` 和 `{role:'assistant',content:answer}` 追加进本地 history，下次请求带最近 3 轮。answer 是纯文本（已过 sanitizeAnswer 清洗），直接渲染，不用解析 JSON。

---

## 7. GET /customers — 客户列表（owed 确认）

- 参数：`page` `pageSize` `keyword`（模糊匹配 name/phone）
- 排序：id 倒序（注意：**不是**按欠款降序——App 客户中心的按欠款排序是前端做的，Web 端要同款排序得自己 sort by owed desc）
- 源码：`server/src/controllers/customers.js` L15-47

真实响应（截断为 1 个元素）：
```json
{"data":{"list":[{
  "id":1,"name":"老王烟酒行","contactPerson":null,"phone":"13800000000",
  "address":null,"notes":null,"productTypeId":1,"isDeleted":0,
  "createdAt":"...","updatedAt":"...",
  "owed":0,"unpaidCount":0}],
 "pagination":{"page":1,"pageSize":2,"total":2,"totalPages":1}}}
```

- **确认：欠款字段就叫 `owed`**（数字，已四舍五入 2 位），另有 `unpaidCount`（该客户未清单据条数，注意源码里它数的是"未清订单条数"）。dashboard「客户欠款」栏用 owed>0 过滤 + 降序即可。注意 owed 是全量算的（不受分页影响，每页每行都准），但列表本身分页——要"欠款 TopN"需拉全量或加大 pageSize 后前端排序。

---

## 通用注意

- 所有时间字段均为 UTC ISO 字符串，Web 端统一转本地时区显示。
- JSON 字段（customFields/specValues 等）在多数列表接口里是**字符串**，只有 alerts 里 specValues 被解码——按接口区分处理。
- 除 /ai/ask 外全部 GET 只读；/ai/ask 也不写库。

✅ 已完成且真测：7 个接口全部先读源码再 curl 真调（含 /ai/ask 真调 DeepSeek 一次），响应样例均为真实返回原文（长数组截断）。全程只读，未创建/修改任何数据。
⚠️ 缩水的地方：
 - /inventory/alerts 当前库存无缺货，真实返回是空数组；元素形状是从源码（L142-151）推的，未见真实非空样例。要验真得改库存数据，任务禁止写操作，故未做。
 - /ai/ask 耗时只测了 1 次（1.16s），未做多次采样，2~15s 的预算是经验值不是实测分布。
本轮无沉淀（接口侦察属一次性调试，产出已直接交给编排方）。
