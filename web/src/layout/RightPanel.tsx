import { useRef, useState } from 'react'
import ActivityFeed from '../features/activity/ActivityFeed'
import AiChatPanel from '../features/ai/AiChatPanel'
import { useAuth } from '../auth'
import { T, primaryRgba } from '../theme'
import { t } from '../lib/i18n'

const RATIO_KEY = 'sm_panel_ratio' // 动态区占比（0.25~0.75），拖拽分隔条调，双击恢复默认
const DEFAULT_RATIO = 0.54

const clamp = (v: number) => Math.min(0.75, Math.max(0.25, v))

// 右栏：最近动态（全员）+ AI 问生意（仅老板；后端 /ai/ask 也是 adminOnly 双保险）。
// 两区之间是可拖拽分隔条，上下高度比例记在本机。
// 收起/展开的把手在 AdminLayout（贴面板左缘）——别在这里加浮动按钮，会和动态区刷新钮重叠。
export default function RightPanel() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const boxRef = useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = useState(() => {
    const v = parseFloat(localStorage.getItem(RATIO_KEY) ?? '')
    return Number.isFinite(v) ? clamp(v) : DEFAULT_RATIO
  })
  const [dragging, setDragging] = useState(false)

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const box = boxRef.current
    if (!box) return
    const onMove = (ev: MouseEvent) => {
      const r = box.getBoundingClientRect()
      const next = clamp((ev.clientY - r.top) / r.height)
      setRatio(next)
    }
    const onUp = (ev: MouseEvent) => {
      const r = box.getBoundingClientRect()
      localStorage.setItem(RATIO_KEY, String(clamp((ev.clientY - r.top) / r.height)))
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none' // 拖动时别刷选中文字
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const resetRatio = () => {
    setRatio(DEFAULT_RATIO)
    localStorage.setItem(RATIO_KEY, String(DEFAULT_RATIO))
  }

  return (
    <div
      ref={boxRef}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 20px 16px',
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: isAdmin ? ratio : 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ActivityFeed />
      </div>
      {isAdmin && (
        <>
          <div
            title={t('拖动调整高度，双击恢复', 'Drag to resize, double-click to reset')}
            onMouseDown={startDrag}
            onDoubleClick={resetRatio}
            style={{
              flexShrink: 0,
              height: 14,
              margin: '2px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'row-resize',
            }}
          >
            <div
              style={{
                width: 44,
                height: 4,
                borderRadius: 999,
                background: dragging ? T.primary : T.outlineVariant,
                opacity: dragging ? 1 : 0.7,
                transition: 'background .15s',
                boxShadow: dragging ? `0 0 8px ${primaryRgba(0.4)}` : undefined,
              }}
            />
          </div>
          <div style={{ flex: 1 - ratio, minHeight: 180, display: 'flex', flexDirection: 'column' }}>
            <AiChatPanel />
          </div>
        </>
      )}
    </div>
  )
}
