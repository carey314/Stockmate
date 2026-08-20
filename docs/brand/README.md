# 品牌资产

图形是「立方体 + 上扬折线」= 库存 + 增长，底色走品牌渐变 `#6063EE → #3B3DBF`。
色值与 `app/lib/core/theme.dart` 的 `AppColors` 同源，改一处必须同步另一处
（Android 侧还有一份 `android/app/src/main/res/values/colors.xml`）。

## 文件

| 文件 | 是什么 | 用在哪 |
|---|---|---|
| `app-icon-source-rounded.png` | 设计原稿，**带圆角+透明四角** | 只做存档，不能直接投产 |
| `app-icon-1024.png` | 满幅化后的投产图标，无 alpha | iOS 15 档 + Android 5 档都从它切 |
| `mark-white.png` | 只有图形，白色，透明底 | Android 12 splash 圆底内、深色背景 |
| `mark-brand.png` | 只有图形，品牌色，透明底 | 浅色背景、web 顶栏、文档水印 |
| `launch-composition.png` | 启动页版式（图标+「智存」）@3x | iOS LaunchImage / Android launch_image |
| `icon-size-preview.png` | 180/120/87/60/40/29px 效果对照 | 改图标后自查小尺寸是否糊 |
| `launch-screen-shot.png` | 启动页模拟器实拍 | 验收留档 |

## 换图标时必做的「满幅化」

设计稿一般带圆角和透明四角，**不能直接塞进 AppIcon**：

1. iOS 会自己套圆角遮罩，图里再带一层就是双重圆角，观感像缩水了一圈
2. App Store 的 1024 图标**禁止 alpha 通道**，带了会在上传时被打回

处理流程（`app/scripts/` 无脚本，当时是临时 Python 跑的，重做时照这个来）：

1. 找非透明像素的边界，裁掉四周留白
2. 取贴边一圈（约 40px）的纯背景像素，最小二乘拟合出线性渐变 `color = a + b·x + c·y`
3. 用拟合的渐变铺满整个方块
4. 原图按 alpha 合成上去 —— 只有四个圆角缺口会用到拟合值，接缝看不出来
5. 存成 RGB（不带 alpha），再从它切各档尺寸

## 启动页的两条硬规矩

**底色必须等于 App 的 `scaffoldBackgroundColor`（#FAF8FF）。** 否则"启动图 → 窗口 → 首帧"
中间会闪一下白。三处都要改：iOS 的 `LaunchScreen.storyboard` 背景色、Android 的
`launch_background.xml`、以及 Android 的 `NormalTheme.windowBackground`（这个最容易漏，
它管的是 Flutter 引擎起来之后、首帧画出来之前那一段）。

**Android 12+ 走的是另一套 API。** 系统强制接管启动页，旧的 `windowBackground` 直接被忽略，
必须在 `values-v31/styles.xml` 里写 `windowSplashScreenBackground` /
`windowSplashScreenAnimatedIcon` / `windowSplashScreenIconBackgroundColor`。
splash 图标规范是 288dp 画布、图形限制在内 192dp 以内（我们放了 160dp，留了安全边），
系统会把它裁成圆形 —— 所以给的是透明底的 `mark-white`，不是方形图标。

## 验收方式

启动页只显示一秒左右，`simctl io screenshot` 单张就要几百毫秒，很容易整个漏掉。
用录屏抽帧才靠得住：

```bash
xcrun simctl io <UDID> recordVideo --codec h264 launch.mov &
xcrun simctl launch <UDID> com.carey.stockmate
# 停止录制后
ffmpeg -i launch.mov -vf fps=20 -q:v 2 frame-%03d.png
```

然后逐帧算「#FAF8FF 占比」和「中心紫色占比」定位启动图那几帧，
顺便查有没有纯白帧（有 = 闪白，说明上面的底色三处没对齐）。
