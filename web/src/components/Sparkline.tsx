// 迷你趋势线（ReactBits Pro simple-graph 的用法，纯 SVG 自实现零依赖）。
// 指标卡右侧的 7 日走势——一眼看出"今天在曲线的什么位置"，不喧宾。
export default function Sparkline({
  data,
  color,
  width = 68,
  height = 30,
}: {
  data: number[]
  color: string
  width?: number
  height?: number
}) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const x = (i: number) => (i / (data.length - 1)) * (width - 4) + 2
  const y = (v: number) => height - 3 - ((v - min) / range) * (height - 6)
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const last = data.length - 1
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      {/* 端点小圆：标出"今天" */}
      <circle cx={x(last)} cy={y(data[last])} r="2.6" fill={color} />
    </svg>
  )
}
