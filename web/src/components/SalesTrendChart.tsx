import { Empty, Spin, Typography } from 'antd'
import { useEffect, useRef } from 'react'
import echarts, { graphic } from '../lib/echarts'
import type { ECharts } from 'echarts/core'
import { T, cardStyle, primaryRgba } from '../theme'

export interface SalesPoint {
  date: string // 服务端 UTC 日字符串，直接展示不做时区换算
  sales: number
  orders: number
}

const RANGES = [7, 30, 90] as const

export default function SalesTrendChart({
  data,
  range,
  loading,
  onRangeChange,
}: {
  data: SalesPoint[] | null
  range: number
  loading: boolean
  onRangeChange: (d: number) => void
}) {
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

  const empty = !!data && data.every((d) => d.sales === 0 && d.orders === 0)

  useEffect(() => {
    if (!chartRef.current || !data) return
    chartRef.current.setOption({
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.date.slice(5)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: T.secondary, fontSize: 12, interval: 'auto' },
        boundaryGap: false,
      },
      yAxis: [
        {
          type: 'value',
          splitNumber: 3,
          splitLine: { lineStyle: { type: 'dashed', color: T.cardBorder } },
          axisLabel: { color: T.secondary, fontSize: 12 },
        },
        { type: 'value', show: false },
      ],
      tooltip: {
        trigger: 'axis',
        backgroundColor: T.inverseSurface,
        borderColor: 'rgba(255,255,255,0.1)',
        padding: 12,
        textStyle: { color: T.inverseOnSurface, fontSize: 13 },
        extraCssText: 'border-radius:14px; box-shadow:0 8px 24px rgba(0,0,0,.25);',
        axisPointer: { type: 'line', lineStyle: { color: T.primary, type: [4, 4] as number[], width: 1 } },
        formatter: (params: unknown) => {
          const ps = params as { axisValue: string; seriesName: string; value: number; color: string }[]
          const rows = ps
            .map(
              (p) =>
                `<div style="display:flex;justify-content:space-between;gap:18px;align-items:center;font-size:13px;margin-top:4px">
                   <span style="display:flex;align-items:center;gap:6px">
                     <span style="width:4px;height:12px;border-radius:99px;background:${p.color}"></span>${p.seriesName}
                   </span><b>${p.seriesName === '销售额' ? '¥' + p.value : p.value}</b></div>`,
            )
            .join('')
          return `<div style="opacity:.8;font-size:12px">${ps[0]?.axisValue ?? ''}</div>${rows}`
        },
      },
      series: [
        {
          name: '销售额',
          type: 'line',
          data: data.map((d) => d.sales),
          smooth: 0.4,
          showSymbol: false,
          lineStyle: { width: 3, color: T.primary, cap: 'round' },
          itemStyle: { color: T.primary },
          emphasis: { itemStyle: { color: '#fff', borderColor: T.primary, borderWidth: 3 } },
          areaStyle: {
            color: new graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: primaryRgba(0.1) },
              { offset: 1, color: primaryRgba(0) },
            ]),
          },
        },
        {
          name: '订单数',
          type: 'line',
          yAxisIndex: 1,
          data: data.map((d) => d.orders),
          smooth: 0.4,
          showSymbol: false,
          lineStyle: { width: 2, color: T.secondaryFixedDim },
          itemStyle: { color: T.secondaryFixedDim },
        },
      ],
    })
  }, [data])

  return (
    <div style={{ ...cardStyle, padding: 24, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <Typography.Text strong style={{ fontSize: 17 }}>
            销售趋势
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 10 }}>
            紫线=销售额 · 灰线=订单数
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <span
              key={r}
              onClick={() => onRangeChange(r)}
              style={{
                padding: '5px 14px',
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: 600,
                whiteSpace: 'nowrap', // 特大字号+窄宽下"7 天"曾被挤成两行
                cursor: 'pointer',
                background: range === r ? T.surfaceContainerLow : T.surfaceContainer,
                color: range === r ? T.primary : T.secondary,
                border: range === r ? `1px solid ${T.primary}33` : '1px solid transparent',
              }}
            >
              {r} 天
            </span>
          ))}
        </div>
      </div>
      <div style={{ position: 'relative' }}>
        <div ref={boxRef} style={{ height: 256, width: '100%' }} />
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.6)',
            }}
          >
            <Spin />
          </div>
        )}
        {empty && !loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Empty description="这段时间还没有销售记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </div>
    </div>
  )
}
