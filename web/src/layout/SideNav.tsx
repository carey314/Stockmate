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
import { T } from '../theme'

export interface NavItem {
  key: string
  icon: React.ReactNode
  label: string
  adminOnly?: boolean
}

// 权限显隐的唯一清单（后端接口本身也有 adminOnly 守卫兜底）。
// 报表大屏对 staff 可见——里面按卡片级隐藏利润/资金流水/员工业绩（与 App 报表中心一致）。
export const NAV: NavItem[] = [
  { key: '/', icon: <HomeOutlined />, label: '工作台' },
  { key: '/todo', icon: <BellOutlined />, label: '待办' },
  { key: '/products', icon: <AppstoreOutlined />, label: '商品管理' },
  { key: '/types', icon: <TagsOutlined />, label: '品类管理' },
  { key: '/partners', icon: <TeamOutlined />, label: '往来单位' },
  { key: '/orders', icon: <ProfileOutlined />, label: '订单管理' },
  { key: '/purchase', icon: <InboxOutlined />, label: '进货管理' },
  { key: '/stocktake', icon: <AuditOutlined />, label: '盘点' },
  { key: '/ledger', icon: <AccountBookOutlined />, label: '收支记账' },
  { key: '/quick-entry', icon: <ThunderboltOutlined />, label: '文本记账' },
  { key: '/reports', icon: <BarChartOutlined />, label: '报表大屏' },
  // 收益日历=现金口径的钱进钱出，只给老板看（与 App 侧同权限；staff 连菜单都不渲染，接口 adminOnly 兜底）
  { key: '/calendar', icon: <CalendarOutlined />, label: '收益日历', adminOnly: true },
  { key: '/statements', icon: <FileTextOutlined />, label: '对账单' },
  { key: '/import', icon: <ImportOutlined />, label: '批量导入' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
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
        background: active ? 'rgba(96, 99, 238, 0.10)' : hover ? T.surfaceContainerLow : 'transparent',
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
            智存后台
          </div>
          <Typography.Text style={{ fontSize: 12, color: T.secondary }}>AI 原生进销存</Typography.Text>
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
          帮助中心
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
          退出登录
        </div>
      </div>
    </aside>
  )
}
