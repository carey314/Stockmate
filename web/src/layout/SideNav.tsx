import { Typography } from 'antd'
import {
  AccountBookOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BarChartOutlined,
  CalendarOutlined,
  FileTextOutlined,
  HomeOutlined,
  BellOutlined,
  ImportOutlined,
  InboxOutlined,
  LogoutOutlined,
  ProfileOutlined,
  ThunderboltOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import { T, primaryRgba } from '../theme'
import { t } from '../lib/i18n'

export interface NavItem {
  key: string
  icon: React.ReactNode
  label: string
  adminOnly?: boolean
}

// 权限显隐的唯一清单（后端接口本身也有 adminOnly 守卫兜底）。
// 报表大屏对 staff 可见——里面按卡片级隐藏利润/资金流水/员工业绩（与 App 报表中心一致）。
export const NAV: NavItem[] = [
  { key: '/', icon: <HomeOutlined />, label: t('工作台', 'Dashboard') },
  { key: '/todo', icon: <BellOutlined />, label: t('待办', 'To-dos') },
  { key: '/products', icon: <AppstoreOutlined />, label: t('商品管理', 'Products') },
  { key: '/types', icon: <TagsOutlined />, label: t('品类管理', 'Categories') },
  { key: '/partners', icon: <TeamOutlined />, label: t('往来单位', 'Partners') },
  { key: '/orders', icon: <ProfileOutlined />, label: t('订单管理', 'Orders') },
  { key: '/purchase', icon: <InboxOutlined />, label: t('进货管理', 'Purchasing') },
  { key: '/stocktake', icon: <AuditOutlined />, label: t('盘点', 'Stocktake') },
  { key: '/ledger', icon: <AccountBookOutlined />, label: t('收支记账', 'Ledger') },
  { key: '/quick-entry', icon: <ThunderboltOutlined />, label: t('文本记账', 'Quick Entry') },
  { key: '/reports', icon: <BarChartOutlined />, label: t('报表大屏', 'Reports') },
  // 收益日历=现金口径的钱进钱出，只给老板看（与 App 侧同权限；staff 连菜单都不渲染，接口 adminOnly 兜底）
  { key: '/calendar', icon: <CalendarOutlined />, label: t('收益日历', 'Cash Calendar'), adminOnly: true },
  { key: '/statements', icon: <FileTextOutlined />, label: t('对账单', 'Statements') },
  { key: '/import', icon: <ImportOutlined />, label: t('批量导入', 'Import') },
  { key: '/settings', icon: <SettingOutlined />, label: t('设置', 'Settings') },
]

// 原型规格：项自身 borderLeft 4px（未激活 transparent 占位防横跳）+ 32px 药丸 + 激活 8% 靛蓝底
function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 32,
        borderLeft: `4px solid ${active ? T.primary : 'transparent'}`,
        cursor: 'pointer',
        color: active || hover ? T.primary : T.secondary,
        fontWeight: active ? 700 : 600,
        fontSize: 13,
        letterSpacing: '0.02em',
        background: active ? primaryRgba(0.1) : hover ? T.surfaceContainerLow : 'transparent',
        transition: 'background .2s, color .2s',
      }}
    >
      <span style={{ fontSize: 20, display: 'flex' }}>{item.icon}</span>
      <span>{item.label}</span>
    </div>
  )
}

export default function SideNav({
  items,
  selected,
  onNavigate,
  onLogout,
}: {
  items: NavItem[]
  selected: string
  onNavigate: (key: string) => void
  onLogout: () => void
}) {
  const [helpHover, setHelpHover] = useState(false)
  const [quitHover, setQuitHover] = useState(false)
  return (
    <aside
      style={{
        width: T.sidebarWidth,
        flexShrink: 0,
        height: '100vh',
        background: T.surface,
        borderRight: `1px solid rgba(199, 196, 215, 0.5)`,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 8px', marginBottom: 40 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${T.primary}, ${T.primaryContainer})`,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          智
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', color: T.primary }}>
            {t('智存后台', 'StockMate Admin')}
          </div>
          <Typography.Text style={{ fontSize: 12, color: T.secondary }}>
            {t('AI 原生进销存', 'AI-native inventory')}
          </Typography.Text>
        </div>
      </div>
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((n) => (
          <NavLink key={n.key} item={n} active={selected === n.key} onClick={() => onNavigate(n.key)} />
        ))}
      </nav>
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          onClick={() => window.open('https://qxju.shop/stockmate/support', '_blank')}
          onMouseEnter={() => setHelpHover(true)}
          onMouseLeave={() => setHelpHover(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: helpHover ? T.primary : T.secondary,
            cursor: 'pointer',
            transition: 'color .2s',
          }}
        >
          <QuestionCircleOutlined style={{ fontSize: 17 }} />
          {t('帮助中心', 'Help Center')}
        </div>
        <div
          onClick={onLogout}
          onMouseEnter={() => setQuitHover(true)}
          onMouseLeave={() => setQuitHover(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: quitHover ? T.error : T.secondary,
            cursor: 'pointer',
            transition: 'color .2s',
          }}
        >
          <LogoutOutlined style={{ fontSize: 17 }} />
          {t('退出登录', 'Sign out')}
        </div>
      </div>
    </aside>
  )
}
