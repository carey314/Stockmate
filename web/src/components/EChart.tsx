import { useEffect, useRef } from 'react'
import echarts from '../lib/echarts'
import type { ECharts } from 'echarts/core'
import { T } from '../theme'

// 通用 echarts 挂载：init 一次 / setOption 响应变化 / ResizeObserver 自适应 / unmount dispose
export default function EChart({ option, height = 240 }: { option: object; height?: number }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ECharts | null>(null)

  useEffect(() => {
    if (!boxRef.current) return
    const chart = echarts.init(boxRef.current)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(boxRef.current)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(
      {
        textStyle: { fontFamily: "Manrope, 'PingFang SC', sans-serif" },
        tooltip: {
          backgroundColor: T.inverseSurface,
          borderColor: 'rgba(255,255,255,0.1)',
          padding: 12,
          textStyle: { color: T.inverseOnSurface, fontSize: 13 },
          extraCssText: 'border-radius:14px; box-shadow:0 8px 24px rgba(0,0,0,.25);',
          ...('tooltip' in option ? (option as { tooltip: object }).tooltip : {}),
        },
        ...option,
      },
      { notMerge: true },
    )
  }, [option])

  return <div ref={boxRef} style={{ height, width: '100%' }} />
}
