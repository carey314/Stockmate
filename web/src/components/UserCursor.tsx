import { useEffect, useRef } from 'react'

// ReactBits Pro「UserCursor」的交互自实现（零依赖 rAF 阻尼弹簧）：
// 彩色箭头光标 + 名字标签 pill，标签用更松的弹簧滞后跟随；按速度方向微倾斜；按下缩压。
// 挂在某个容器上（该区域 cursor:none 由调用方设置），触屏/减弱动态下自动不启用。
export default function UserCursor({
  containerRef,
  label,
  color = '#fff',
  textColor = '#4648d4',
}: {
  containerRef: React.RefObject<HTMLElement | null>
  label: string
  color?: string
  textColor?: string
}) {
  const arrowRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = containerRef.current
    const arrow = arrowRef.current
    const pill = labelRef.current
    if (!box || !arrow || !pill) return
    if (window.matchMedia('(pointer: coarse)').matches) return // 触屏不启用
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let tx = 0, ty = 0 // 目标（鼠标）
    let ax = 0, ay = 0 // 箭头当前位置
    let lx = 0, ly = 0 // 标签当前位置（更松，滞后出"secondary motion"）
    let visible = false
    let pressed = false
    let raf = 0

    const onMove = (e: MouseEvent) => {
      const r = box.getBoundingClientRect()
      tx = e.clientX - r.left
      ty = e.clientY - r.top
      if (!visible) {
        visible = true
        ax = lx = tx
        ay = ly = ty
        arrow.style.opacity = '1'
        pill.style.opacity = '1'
      }
    }
    const onLeave = () => {
      visible = false
      arrow.style.opacity = '0'
      pill.style.opacity = '0'
    }
    const onDown = () => { pressed = true }
    const onUp = () => { pressed = false }

    const tick = () => {
      const pax = ax
      ax += (tx - ax) * 0.28
      ay += (ty - ay) * 0.28
      lx += (tx - lx) * 0.12
      ly += (ty - ly) * 0.12
      // 方向感知微倾斜：按水平速度倾 -18°~18°
      const vx = ax - pax
      const tiltDeg = Math.max(-18, Math.min(18, vx * 2.2))
      const scale = pressed ? 0.92 : 1
      arrow.style.transform = `translate(${ax}px, ${ay}px) rotate(${tiltDeg}deg) scale(${scale})`
      pill.style.transform = `translate(${lx + 14}px, ${ly + 18}px) scale(${scale})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    box.addEventListener('mousemove', onMove)
    box.addEventListener('mouseleave', onLeave)
    box.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      cancelAnimationFrame(raf)
      box.removeEventListener('mousemove', onMove)
      box.removeEventListener('mouseleave', onLeave)
      box.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [containerRef])

  const common: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    pointerEvents: 'none',
    opacity: 0,
    transition: 'opacity .2s',
    zIndex: 30,
    willChange: 'transform',
  }
  return (
    <>
      <div ref={arrowRef} style={common}>
        {/* 经典光标箭头，填充色可配，带细描边保证任何底色可读 */}
        <svg width="22" height="22" viewBox="0 0 24 24" style={{ display: 'block' }}>
          <path
            d="M5 3 L19 12.5 L12.6 13.8 L9.5 19.8 Z"
            fill={color}
            stroke="rgba(0,0,0,0.25)"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div
        ref={labelRef}
        style={{
          ...common,
          background: color,
          color: textColor,
          fontSize: 12,
          fontWeight: 700,
          padding: '3px 10px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        }}
      >
        {label}
      </div>
    </>
  )
}
