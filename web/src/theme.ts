import type { ThemeConfig } from 'antd'
import type { CSSProperties } from 'react'

// 设计令牌事实源：~/Downloads/browser/stitch_smart_ai_inventory_hub 2/aetheric_dashboard/DESIGN.md
// 圆角口径（定死，模块 2-5 沿用）：卡片 24 / 导航项 32 药丸 / 小控件 12 / 按钮 999。
// 原型源码的 rounded-xl=48px 是 Tailwind config 覆写陷阱，官方散文口径是 24px 卡。

// ===== 主题色预设 =====
// 换主题 = localStorage 存 key + reload：全项目内联样式都引 T，加载时替换一次即全局生效，
// 不需要把几百处内联样式改成 CSS 变量/Context（改造面与收益完全不成比例）。
export interface ThemePreset {
  key: string
  name: string
  nameEn: string
  primary: string
  primaryContainer: string
  primaryFixed: string
  rgb: string // 'r, g, b'，供阴影/水波纹底等 rgba() 派生
}

export const THEME_PRESETS: ThemePreset[] = [
  { key: 'indigo', name: '靛蓝紫', nameEn: 'Indigo', primary: '#4648d4', primaryContainer: '#6063ee', primaryFixed: '#e1e0ff', rgb: '70, 72, 212' },
  { key: 'emerald', name: '松石绿', nameEn: 'Emerald', primary: '#0e9271', primaryContainer: '#10b981', primaryFixed: '#d2f2e6', rgb: '14, 146, 113' },
  { key: 'ocean', name: '海蓝', nameEn: 'Ocean', primary: '#1268c3', primaryContainer: '#3b82f6', primaryFixed: '#dbeafe', rgb: '18, 104, 195' },
  { key: 'sunset', name: '暖橙', nameEn: 'Sunset', primary: '#d4680a', primaryContainer: '#f59e0b', primaryFixed: '#ffedd5', rgb: '212, 104, 10' },
  { key: 'rose', name: '玫红', nameEn: 'Rose', primary: '#c2266d', primaryContainer: '#ec4899', primaryFixed: '#fce7f3', rgb: '194, 38, 109' },
]

export const THEME_KEY = 'sm_theme'
const savedTheme = THEME_PRESETS.find((p) => p.key === localStorage.getItem(THEME_KEY)) ?? THEME_PRESETS[0]
export const activeTheme = savedTheme

export const setThemePreset = (key: string) => {
  localStorage.setItem(THEME_KEY, key)
  location.reload() // 内联样式在各组件模块里已经算好，只有 reload 能全量生效
}

// 主色带透明度（阴影/激活底/图表渐变等派生场景统一走这里，别再写死 rgba）
export const primaryRgba = (alpha: number) => `rgba(${savedTheme.rgb}, ${alpha})`

export const T = {
  primary: savedTheme.primary,
  primaryContainer: savedTheme.primaryContainer,
  primaryFixed: savedTheme.primaryFixed,
  surface: '#f9f9ff',
  surfaceContainerLow: '#f0f3ff',
  surfaceContainer: '#e7eeff',
  surfaceContainerHigh: '#dee8ff',
  surfaceVariant: '#d8e3fb',
  onSurface: '#111c2d',
  onSurfaceVariant: '#464554',
  secondary: '#516072',
  secondaryFixedDim: '#b9c8de', // 图表副线
  inverseSurface: '#263143', // 深色 tooltip 底
  inverseOnSurface: '#ecf1ff',
  outlineVariant: '#c7c4d7',
  cardBorder: '#e2e8f0',
  error: '#ba1a1a',
  errorContainer: '#ffdad6',
  emerald: '#10b981',
  orange: '#f97316',
  radiusCard: 24,
  cardShadow: `0 4px 24px rgba(${savedTheme.rgb}, 0.05)`,
  ambientShadow: `0 10px 40px -10px rgba(${savedTheme.rgb}, 0.08)`,
  glowShadow: `0 0 15px rgba(${savedTheme.rgb}, 0.4)`,
  sidebarWidth: 260,
  rightPanelWidth: 320,
  topBarHeight: 80,
  gutter: 24,
}

// 玻璃卡统一样式：所有卡片（antd Card 或裸 div）直接 spread
export const cardStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.95)',
  border: '1px solid rgba(226, 232, 240, 0.8)',
  borderRadius: T.radiusCard,
  boxShadow: T.cardShadow,
}

export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: T.primary,
    colorText: T.onSurface,
    colorTextSecondary: T.secondary,
    colorBgLayout: T.surface,
    colorBorderSecondary: T.cardBorder,
    colorError: T.error,
    borderRadius: 12,
    fontFamily:
      "Manrope, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif",
  },
  components: {
    Button: { borderRadius: 999, borderRadiusLG: 999, borderRadiusSM: 999 },
    Card: { borderRadiusLG: T.radiusCard, boxShadowTertiary: T.cardShadow },
    Input: { borderRadius: 12, borderRadiusLG: 14 },
    Select: { borderRadius: 12 },
    Table: { borderRadiusLG: T.radiusCard, headerBg: T.surfaceContainerLow },
    Tag: { borderRadiusSM: 999 },
    Modal: { borderRadiusLG: 20 },
    // Drawer 不许全局设 paddingLG:0——订单/进货/盘点详情抽屉都吃默认 padding，
    // 设 0 会让它们全部贴边（用户截过图）。要 0 的地方（布局层两个 Drawer）自己显式设。
  },
}
