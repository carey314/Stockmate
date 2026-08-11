import { Drawer } from 'antd'
import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { T } from '../theme'
import SideNav, { NAV } from './SideNav'
import TopBar from './TopBar'
import RightPanel from './RightPanel'
import { useMediaQuery } from '../lib/useMediaQuery'

// 三栏 AppShell：外壳 100vh 不滚动，滚动只发生在 main 滚动区和右栏内部
export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const wide = useMediaQuery('(min-width: 1280px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const isAdmin = user?.role === 'admin'

  const items = NAV.filter((n) => isAdmin || !n.adminOnly)
  // 让 /products/xxx 也高亮 /products
  const selected =
    NAV.map((n) => n.key)
      .filter((k) => k !== '/')
      .find((k) => location.pathname.startsWith(k)) || '/'

  const title =
    selected === '/'
      ? `你好，${user?.realName || user?.username || ''}`
      : (NAV.find((n) => n.key === selected)?.label ?? '')

  const doLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.surface }}>
      <SideNav items={items} selected={selected} onNavigate={navigate} onLogout={doLogout} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar
          title={title}
          onLogout={doLogout}
          onOpenPanel={wide ? undefined : () => setDrawerOpen(true)}
        />
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 32px 32px' }}>
          <Outlet />
        </div>
      </div>
      {wide ? (
        <aside
          style={{
            width: T.rightPanelWidth,
            flexShrink: 0,
            height: '100vh',
            borderLeft: '1px solid rgba(199, 196, 215, 0.3)',
            background: T.surface,
            overflow: 'hidden',
          }}
        >
          <RightPanel />
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
