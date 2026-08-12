import { Drawer } from 'antd'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { T } from '../theme'
import { t } from '../lib/i18n'
import SideNav, { NAV } from './SideNav'
import TopBar from './TopBar'
import RightPanel from './RightPanel'
import { useMediaQuery } from '../lib/useMediaQuery'

const PANEL_KEY = 'sm_panel_collapsed'

// 三栏 AppShell：外壳 100vh 不滚动，滚动只发生在 main 滚动区和右栏内部
export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const wide = useMediaQuery('(min-width: 1280px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 右栏（最近动态 + AI 问生意）可收起，偏好记住；收起后主内容区变宽
  const [panelCollapsed, setPanelCollapsed] = useState(() => localStorage.getItem(PANEL_KEY) === '1')
  const togglePanel = () =>
    setPanelCollapsed((c) => {
      localStorage.setItem(PANEL_KEY, c ? '0' : '1')
      return !c
    })
  const isAdmin = user?.role === 'admin'

  const items = NAV.filter((n) => isAdmin || !n.adminOnly)
  // 让 /products/xxx 也高亮 /products
  const selected =
    NAV.map((n) => n.key)
      .filter((k) => k !== '/')
      .find((k) => location.pathname.startsWith(k)) || '/'

  const title =
    selected === '/'
      ? `${t('你好', 'Hello')}，${user?.realName || user?.username || ''}`
      : (NAV.find((n) => n.key === selected)?.label ?? '')

  const doLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  // 铃铛按钮：窄屏=开 Drawer；宽屏且已收起=重新展开右栏
  const onOpenPanel = wide ? (panelCollapsed ? togglePanel : undefined) : () => setDrawerOpen(true)

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.surface }}>
      <SideNav items={items} selected={selected} onNavigate={navigate} onLogout={doLogout} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar title={title} onLogout={doLogout} onOpenPanel={onOpenPanel} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 32px 32px' }}>
          <Outlet />
        </div>
      </div>
      {wide ? (
        <aside
          style={{
            width: panelCollapsed ? 0 : T.rightPanelWidth,
            flexShrink: 0,
            height: '100vh',
            borderLeft: panelCollapsed ? 'none' : '1px solid rgba(199, 196, 215, 0.3)',
            background: T.surface,
            overflow: 'hidden',
            transition: 'width .25s ease',
          }}
        >
          {/* 内层固定宽度：收起动画时内容不被挤压变形 */}
          <div style={{ width: T.rightPanelWidth, height: '100%' }}>
            <RightPanel onCollapse={togglePanel} />
          </div>
        </aside>
      ) : (
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          width={360}
          title={null}
          closable={false}
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          <RightPanel />
        </Drawer>
      )}
    </div>
  )
}
