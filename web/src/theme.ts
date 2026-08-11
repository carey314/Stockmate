import type { ThemeConfig } from 'antd'
import type { CSSProperties } from 'react'

// 设计令牌事实源：~/Downloads/browser/stitch_smart_ai_inventory_hub 2/aetheric_dashboard/DESIGN.md
// 圆角口径（定死，模块 2-5 沿用）：卡片 24 / 导航项 32 药丸 / 小控件 12 / 按钮 999。
// 原型源码的 rounded-xl=48px 是 Tailwind config 覆写陷阱，官方散文口径是 24px 卡。
export const T = {
  primary: '#4648d4',
  primaryContainer: '#6063ee',
  primaryFixed: '#e1e0ff',
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
  cardShadow: '0 4px 24px rgba(99, 102, 241, 0.05)',
  ambientShadow: '0 10px 40px -10px rgba(70, 72, 212, 0.08)',
  glowShadow: '0 0 15px rgba(70, 72, 212, 0.4)',
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
    Drawer: { paddingLG: 0 },
  },
}
