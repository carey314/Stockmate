import { useEffect, useRef, useState } from 'react'

// 数字滚动到位（ReactBits CountUp 的交互，自写零依赖：20 行 rAF 不值得引 framer-motion +35KB）。
// 值更新时从上一个显示值滚到新值（切月/刷新时有"数字在动=刚算出来"的感知）。
const reduced =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function CountUp({
  value,
  format = (n) => String(Math.round(n)),
  duration = 700,
  speedBlur = false, // ReactBits SpeedingText 的速度感：滚得快时运动模糊，落定清晰（只给关键金额开）
}: {
  value: number
  format?: (n: number) => string
  duration?: number
  speedBlur?: boolean
}) {
  const [display, setDisplay] = useState(reduced ? value : 0)
  const fromRef = useRef(reduced ? value : 0)
  const spanRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (reduced) {
      setDisplay(value)
      fromRef.current = value
      return
    }
    const from = fromRef.current
    if (from === value) {
      setDisplay(value)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const total = Math.abs(value - from) || 1
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic：先快后慢，像秤盘落定
      const v = p === 1 ? value : from + (value - from) * eased
      if (speedBlur && spanRef.current) {
        // 模糊量 ∝ 本帧变化速率；easeOut 天然"开始糊、落定清"
        const blur = p === 1 ? 0 : Math.min(4, (Math.abs(v - fromRef.current) / total) * 40)
        spanRef.current.style.filter = blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : ''
      }
      // fromRef 跟随"当前显示到哪"，动画被打断（StrictMode 双跑 / 值中途再变）就从断点续滚。
      // 千万别在 cleanup 里把它设成目标值——StrictMode 第二遍 effect 会误判"已到位"，数字永远卡 0。
      fromRef.current = v
      setDisplay(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, speedBlur])

  return <span ref={spanRef}>{format(display)}</span>
}
