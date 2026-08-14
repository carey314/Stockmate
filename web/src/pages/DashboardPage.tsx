import { Button, Typography } from 'antd'
import {
  AccountBookOutlined,
  AppstoreOutlined,
  RiseOutlined,
  ShoppingOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../auth'
import StatCard from '../components/StatCard'
import CountUp from '../components/CountUp'
import SalesTrendChart, { type SalesPoint } from '../components/SalesTrendChart'
import RestockCard from '../components/RestockCard'
import { fmtMoney } from '../lib/format'
import { T, cardStyle } from '../theme'

interface Overview {
  todaySales: number
  todayOrderCount: number
  todayProfit: number
  profitUnreliable: boolean
  noCostSales: number
  noCostProductNames: string[]
  lowStockCount: number
  productCount: number
}

export default function DashboardPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'admin'

  const [ov, setOv] = useState<Overview | null>(null)
  const [ovError, setOvError] = useState<string | null>(null)
  const [range, setRange] = useState(7)
  const [series, setSeries] = useState<SalesPoint[] | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  // 趋势基线固定用首个 7 天数据（末两日 = UTC 今日 vs 前一日），切 30/90 不影响趋势卡
  const [trendBase, setTrendBase] = useState<SalesPoint[] | null>(null)

  const loadOverview = () => {
    setOvError(null)
    api
      .get<Overview>('/stats/overview')
      .then(setOv)
      .catch((e) => setOvError((e as Error).message))
  }
  useEffect(loadOverview, [])

  useEffect(() => {
    let alive = true
    setChartLoading(true)
    api
      .get<SalesPoint[]>('/stats/sales', { days: range })
      .then((d) => {
        if (!alive) return
        setSeries(d)
        if (range === 7) setTrendBase((prev) => prev ?? d)
      })
      .catch(() => alive && setSeries([]))
      .finally(() => alive && setChartLoading(false))
    return () => {
      alive = false
    }
  }, [range])

  // 大数字用 overview（服务端"今日"口径），趋势 % 用 sales 数组末两日（UTC 日切，口径有 8h 错位，
  // 故文案写「较前一日」）。分母为 0 不显示趋势——任何百分比都是噪音。
  const trend = useMemo(() => {
    if (!trendBase || trendBase.length < 2) return { sales: null, orders: null }
    const t = trendBase[trendBase.length - 1]
    const y = trendBase[trendBase.length - 2]
    return {
      sales: y.sales === 0 ? null : (t.sales - y.sales) / y.sales,
      orders: y.orders === 0 ? null : (t.orders - y.orders) / y.orders,
    }
  }, [trendBase])

  // 空店（第一天）引导：没商品时给出三步开张动线，别让新用户对着一堆 0 发懵
  const isEmptyStore = ov !== null && ov.productCount === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {profile?.shopName || '你的店'} · 批量改商品、看报表、打对账单，都比手机上快
      </Typography.Text>
      {isEmptyStore && (
        <div style={{ ...cardStyle, padding: 28, background: 'linear-gradient(120deg, #f0f3ff, #e7eeff)' }}>
          <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
            👋 欢迎开张！三步就能开始做生意
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 18, fontSize: 13 }}>
            你的店还是空的。跟着下面走一遍，几分钟就能把家底录进来。
          </Typography.Paragraph>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { n: 1, t: '配好你的品类', d: '换个行业？让 AI 帮你配字段', to: '/types', btn: '去品类管理' },
              { n: 2, t: '录入你的商品', d: '一批货粘贴进来，AI 整理成清单', to: '/import', btn: '去批量导入' },
              { n: 3, t: '在手机上开单', d: '扫码/语音开单收钱在 App 更顺手', to: null, btn: '打开手机 App' },
            ].map((s) => (
              <div key={s.n} style={{ flex: '1 1 200px', background: '#fff', borderRadius: 16, padding: 18 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    background: T.primary,
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    marginBottom: 10,
                  }}
                >
                  {s.n}
                </div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.t}</div>
                <div style={{ fontSize: 12, color: T.secondary, marginBottom: 12, minHeight: 32 }}>{s.d}</div>
                {s.to ? (
                  <Button type="primary" size="small" onClick={() => navigate(s.to!)}>
                    {s.btn}
                  </Button>
                ) : (
                  <Button size="small" disabled>
                    {s.btn}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {ovError ? (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <Typography.Text type="secondary">{ovError}</Typography.Text>
          <br />
          <Button style={{ marginTop: 10 }} onClick={loadOverview}>
            重试
          </Button>
        </div>
      ) : (
        ov && (
          // CSS grid auto-fit 而非 antd Col：Col 断点走媒体查询，感知不到「文字特大」的
          // body zoom——zoom 1.25 时仍硬排 4 列，每张卡被挤到 130px，标题一字一行竖排。
          // minmax 按真实可用宽度自动决定一行几张，zoom/窄屏都正确响应。
          // minmax 195：1500 视口（含右栏）恰好一行 4 张；再窄/字号特大时自动降列数
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: 20 }}>
            <StatCard
              title="今日销售额"
              value={<CountUp value={ov.todaySales} format={fmtMoney} />}
              icon={<AccountBookOutlined />}
              trend={trend.sales}
            />
            <StatCard
              title="今日订单数"
              value={<CountUp value={ov.todayOrderCount} />}
              icon={<ShoppingOutlined />}
              trend={trend.orders}
            />
            {isAdmin ? (
              <StatCard
                title="今日毛利"
                value={<CountUp value={ov.todayProfit} format={fmtMoney} />}
                icon={<RiseOutlined />}
                note={
                  ov.profitUnreliable
                    ? `其中 ${fmtMoney(ov.noCostSales)} 的货没填进价（${ov.noCostProductNames
                        .slice(0, 2)
                        .join('、')}${ov.noCostProductNames.length > 2 ? '…' : ''}）`
                    : undefined
                }
              />
            ) : (
              <StatCard title="在售商品" value={<CountUp value={ov.productCount} />} icon={<AppstoreOutlined />} />
            )}
            <StatCard
              title="库存预警"
              value={<CountUp value={ov.lowStockCount} />}
              icon={<WarningOutlined />}
              alert={ov.lowStockCount > 0}
            />
          </div>
        )
      )}
      <SalesTrendChart data={series} range={range} loading={chartLoading} onRangeChange={setRange} />
      {ov && ov.lowStockCount > 0 && <RestockCard />}
      {!isAdmin && (
        <Typography.Text type="secondary" style={{ fontSize: 12, color: T.secondary }}>
          员工账号看不到毛利与 AI 助手，如需请找老板开通管理员。
        </Typography.Text>
      )}
    </div>
  )
}
