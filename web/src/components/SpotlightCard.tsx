import { useRef, type CSSProperties, type ReactNode } from 'react'
import { primaryRgba } from '../theme'

// 鼠标跟随高光卡（ReactBits SpotlightCard 的交互，CSS 变量实现，样式在 index.css .spotlight-card）。
// 高光颜色跟主题色走；坐标写 CSS 变量不走 React 状态——mousemove 每帧 setState 会白白重渲染。
export default function SpotlightCard({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--spot-x', `${e.clientX - r.left}px`)
    el.style.setProperty('--spot-y', `${e.clientY - r.top}px`)
  }
  return (
    <div
      ref={ref}
      className="spotlight-card"
      onMouseMove={onMove}
      style={{ ...style, ['--spot-color' as string]: primaryRgba(0.09) }}
    >
      {children}
    </div>
  )
}
