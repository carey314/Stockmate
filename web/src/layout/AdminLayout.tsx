import { Drawer, Tooltip } from 'antd'
import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import ErrorBoundary from '../components/ErrorBoundary'
import CommandPalette from '../components/CommandPalette'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { T } from '../theme'
import { t } from '../lib/i18n'
import SideNav, { NAV } from './SideNav'
import TopBar from './TopBar'
import RightPanel from './RightPanel'
import { useMediaQuery } from '../lib/useMediaQuery'

const PANEL_KEY = 'sm_panel_collapsed'

// 三栏 AppShell：外壳 100vh 不滚动，滚动只发生在 main 滚动区和右栏内部。
// 响应式：≥1280 三栏全开；1024~1280 右栏变 Drawer（顶栏铃铛开）；<1024 侧栏也变 Drawer（顶栏汉堡开）。
export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const wide = useMediaQuery('(min-width: 1280px)')
  const lg = useMediaQuery('(min-width: 1024px)')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
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

  // Cmd/Ctrl+K 全局搜索
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 浏览器标签页标题跟随当前页（市面后台标配——多开几个 tab 时能分清哪个是哪个）
  useEffect(() => {
    const page = selected === '/' ? t('工作台', 'Dashboard') : (NAV.find((n) => n.key === selected)?.label ?? '')
    document.title = `${page} · ${t('智存后台', 'StockMate Admin')}`
  }, [selected])

  const nav = (key: string) => {
    navigate(key)
    setNavOpen(false)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: T.surface }}>
      {lg ? (
        <SideNav items={items} selected={selected} onNavigate={nav} onLogout={doLogout} />
      ) : (
        <Drawer
          open={navOpen}
          onClose={() => setNavOpen(false)}
          placement="left"
          width={T.sidebarWidth + 16}
          title={null}
          closable={false}
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          <SideNav items={items} selected={selected} onNavigate={nav} onLogout={doLogout} />
        </Drawer>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar
          title={title}
          onLogout={doLogout}
          onOpenNav={lg ? undefined : () => setNavOpen(true)}
          onOpenPanel={wide ? (panelCollapsed ? togglePanel : undefined) : () => setDrawerOpen(true)}
          onOpenSearch={() => setPaletteOpen(true)}
        />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        <div style={{ flex: 1, overflowY: 'auto', padding: lg ? '4px 32px 32px' : '4px 16px 24px' }}>
          {/* key=selected：切页面时重置错误状态，坏掉的页不拖累下一页 */}
          <ErrorBoundary key={selected}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
      {/* 右栏收放把手：贴着面板左缘，收起时滑到屏幕右缘。单把手随面板滑动，
          别再把按钮放进面板头部——会和「最近动态」的刷新钮重叠（用户截过图） */}
      {wide && (
        <Tooltip
          title={panelCollapsed ? t('展开动态与 AI 助手', 'Expand panel') : t('收起面板', 'Collapse panel')}
          placement="left"
        >
          <div
            onClick={togglePanel}
            style={{
              position: 'fixed',
              right: panelCollapsed ? 0 : T.rightPanelWidth,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 100,
              width: 20,
              height: 60,
              borderRadius: '10px 0 0 10px',
              background: '#fff',
              border: `1px solid ${T.cardBorder}`,
              borderRight: 'none',
              boxShadow: T.cardShadow,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: T.secondary,
              transition: 'right .25s ease',
            }}
          >
            {panelCollapsed ? (
              <DoubleLeftOutlined style={{ fontSize: 10 }} />
            ) : (
              <DoubleRightOutlined style={{ fontSize: 10 }} />
            )}
          </div>
        </Tooltip>
      )}
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
            <RightPanel />
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
