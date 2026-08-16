import { Alert, DatePicker, Skeleton, Statistic, Table, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { useAuth } from '../auth'
import EChart from '../components/EChart'
import { fmtMoney, fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { T, cardStyle } from '../theme'

// ===== 接口形状（对齐 reports.js）=====
interface ProfitRep {
  sales: number
  cogs: number
  expenses: number
  profit: number
  lossAmount: number // 报损/过期/损坏的货按进价估的损失（单列，不并入利润口径）
  orderCount: number
  byDay: { date: string; sales: number; profit: number }[]
}
interface SalesRep {
  list: { productName: string; specText: string | null; qty: number; amount: number; profit: number }[]
  totalAmount: number
}
interface InvRep {
  totalStock: number
  totalValue: number
  skuCount: number
  byType: { name: string; stock: number; value: number }[]
  lowStock: { productName: string; specText: string; stock: number; minQuantity: number }[]
}
interface CashRep {
  inflow: number
  outflow: number
  net: number
  rows: { at: string; type: string; amount: number; note: string | null; account: string | null }[]
}
interface StaffRep {
  list: { name: string; orders: number; sales: number; profit: number }[]
}
interface PurchaseRep {
  total: number
  orderCount: number
  byProduct: { name: string; qty: number; amount: number }[]
  bySupplier: { name: string; amount: number; orders: number }[]
}

const PRESETS: { label: string; range: () => [Dayjs, Dayjs] }[] = [
  { label: t('今天', 'Today'), range: () => [dayjs(), dayjs()] },
  { label: t('近7天', 'Last 7 days'), range: () => [dayjs().subtract(6, 'day'), dayjs()] },
  { label: t('近30天', 'Last 30 days'), range: () => [dayjs().subtract(29, 'day'), dayjs()] },
  { label: t('本月', 'This month'), range: () => [dayjs().startOf('month'), dayjs()] },
]

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <Typography.Text strong style={{ fontSize: 17 }}>
          {title}
        </Typography.Text>
        {extra}
      </div>
      {children}
    </div>
  )
}

function useReport<T>(url: string, params: object | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = JSON.stringify(params)
  useEffect(() => {
    if (params === null) return
    let alive = true
    setData(null)
    setError(null)
    api
      .get<T>(url, params)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key])
  return { data, error }
}

function Body<T>({ data, error, children }: { data: T | null; error: string | null; children: (d: T) => React.ReactNode }) {
  if (error) return <Alert type="warning" message={error} showIcon />
  if (!data) return <Skeleton active paragraph={{ rows: 4 }} />
  return <>{children(data)}</>
}

const stat = (title: string, value: number, money = true, color?: string) => (
  <Statistic
    title={title}
    value={money ? fmtMoney(value) : value}
    styles={{ content: { fontSize: 22, fontWeight: 700, ...(color ? { color } : {}) } }}
  />
)

export default function ReportsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // 日期区间进 URL（?from=&to=）：分享"上个月报表"这类链接不丢
  const [urlParams, setUrlParams] = useSearchParams()
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => {
    const f = urlParams.get('from')
    const t = urlParams.get('to')
    return f && t && dayjs(f).isValid() && dayjs(t).isValid() ? [dayjs(f), dayjs(t)] : PRESETS[1].range()
  })
  useEffect(() => {
    setUrlParams(
      { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') },
      { replace: true },
    )
  }, [range, setUrlParams])
  const params = useMemo(
    () => ({ startDate: range[0].format('YYYY-MM-DD'), endDate: range[1].format('YYYY-MM-DD') }),
    [range],
  )

  const profit = useReport<ProfitRep>('/reports/profit', isAdmin ? params : null)
  const sales = useReport<SalesRep>('/reports/sales-by-product', params)
  const inv = useReport<InvRep>('/reports/inventory', {})
  const cash = useReport<CashRep>('/reports/cashflow', isAdmin ? params : null)
  const staff = useReport<StaffRep>('/reports/staff-performance', isAdmin ? params : null)
  const purchase = useReport<PurchaseRep>('/reports/purchase-stats', params)

  const setPreset = useCallback((r: [Dayjs, Dayjs]) => setRange(r), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 日期范围 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => {
          const r = p.range()
          const active = range[0].isSame(r[0], 'day') && range[1].isSame(r[1], 'day')
          return (
            <span
              key={p.label}
              onClick={() => setPreset(r)}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: active ? T.surfaceContainerLow : T.surfaceContainer,
                color: active ? T.primary : T.secondary,
                border: active ? `1px solid ${T.primary}33` : '1px solid transparent',
              }}
            >
              {p.label}
            </span>
          )
        })}
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
          style={{ borderRadius: 999 }}
        />
        {!isAdmin && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('利润 / 资金流水 / 员工业绩仅老板可见', 'Profit / cash flow / staff performance are visible to the owner only')}
          </Typography.Text>
        )}
      </div>

      {/* 经营利润（仅老板）*/}
      {isAdmin && (
        <Card title={t('经营利润', 'Profit')}>
          <Body data={profit.data} error={profit.error}>
            {(d) => (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 16, marginBottom: 12 }}>
                  {stat(t('销售额', 'Revenue'), d.sales)}
                  {stat(t('销货成本', 'Cost of goods sold'), d.cogs)}
                  {stat(t('经营支出', 'Operating expenses'), d.expenses)}
                  {stat(t('利润', 'Profit'), d.profit, true, d.profit >= 0 ? T.emerald : T.error)}
                  {d.lossAmount > 0 && stat(t('损耗（报损/过期）', 'Loss (damaged / expired)'), d.lossAmount, true, T.orange)}
                  {stat(t('订单数', 'Orders'), d.orderCount, false)}
                </div>
                {d.byDay.length > 1 && (
                  <EChart
                    height={220}
                    option={{
                      grid: { left: 8, right: 8, top: 30, bottom: 8, containLabel: true },
                      legend: { top: 0, textStyle: { color: T.secondary } },
                      tooltip: { trigger: 'axis' },
                      xAxis: {
                        type: 'category',
                        data: d.byDay.map((x) => x.date.slice(5)),
                        axisLine: { show: false },
                        axisTick: { show: false },
                        axisLabel: { color: T.secondary, fontSize: 12 },
                      },
                      yAxis: {
                        type: 'value',
                        splitNumber: 3,
                        splitLine: { lineStyle: { type: 'dashed', color: T.cardBorder } },
                        axisLabel: { color: T.secondary, fontSize: 12 },
                      },
                      series: [
                        { name: t('销售额', 'Revenue'), type: 'line', smooth: 0.4, showSymbol: false, data: d.byDay.map((x) => x.sales), lineStyle: { width: 3, color: T.primary }, itemStyle: { color: T.primary } },
                        { name: t('利润', 'Profit'), type: 'line', smooth: 0.4, showSymbol: false, data: d.byDay.map((x) => x.profit), lineStyle: { width: 2, color: T.emerald }, itemStyle: { color: T.emerald } },
                      ],
                    }}
                  />
                )}
              </>
            )}
          </Body>
        </Card>
      )}

      {/* 销售按商品 */}
      <Card title={t('销售统计（按商品）', 'Sales by product')}>
        <Body data={sales.data} error={sales.error}>
          {(d) =>
            d.list.length === 0 ? (
              <Typography.Text type="secondary">{t('这段时间没有销售记录', 'No sales in this period')}</Typography.Text>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                <EChart
                  height={Math.max(200, Math.min(8, d.list.length) * 36 + 40)}
                  option={{
                    grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true },
                    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
                    xAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: T.cardBorder } }, axisLabel: { color: T.secondary, fontSize: 11 } },
                    yAxis: {
                      type: 'category',
                      inverse: true,
                      data: d.list.slice(0, 8).map((x) => `${x.productName}${x.specText ? ` ${x.specText}` : ''}`.slice(0, 12)),
                      axisLine: { show: false },
                      axisTick: { show: false },
                      axisLabel: { color: T.onSurfaceVariant, fontSize: 12 },
                    },
                    series: [
                      {
                        name: t('销售额', 'Revenue'),
                        type: 'bar',
                        barWidth: 14,
                        data: d.list.slice(0, 8).map((x) => x.amount),
                        itemStyle: { color: T.primary, borderRadius: [0, 99, 99, 0] },
                      },
                    ],
                  }}
                />
                <Table
                  size="small"
                  rowKey={(r) => `${r.productName}|${r.specText}`}
                  dataSource={d.list.slice(0, 10)}
                  pagination={false}
                  columns={[
                    { title: t('商品', 'Product'), render: (_, r) => `${r.productName}${r.specText ? `（${r.specText}）` : ''}` },
                    { title: t('数量', 'Qty'), dataIndex: 'qty', width: 70, render: (v) => fmtQty(v) },
                    { title: t('金额', 'Amount'), dataIndex: 'amount', width: 90, render: (v) => fmtMoney(v) },
                    ...(isAdmin
                      ? [{ title: t('毛利', 'Gross profit'), dataIndex: 'profit', width: 90, render: (v: number) => fmtMoney(v) }]
                      : []),
                  ]}
                  footer={() => t(`合计 ${fmtMoney(d.totalAmount)}`, `Total ${fmtMoney(d.totalAmount)}`)}
                />
              </div>
            )
          }
        </Body>
      </Card>

      {/* 库存统计（时点数据，不吃日期范围）*/}
      <Card
        title={t('库存统计', 'Inventory stats')}
        extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('此刻时点数据，不受日期筛选影响', 'Live snapshot — not affected by the date filter')}</Typography.Text>}
      >
        <Body data={inv.data} error={inv.error}>
          {(d) => (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
                  {stat(t('库存总值（按成本）', 'Stock value (at cost)'), d.totalValue)}
                  {stat(t('总件数', 'Total units'), d.totalStock, false)}
                  {stat(t('规格数', 'SKUs'), d.skuCount, false)}
                </div>
                {d.byType.length > 0 && (
                  <EChart
                    height={200}
                    option={{
                      tooltip: { trigger: 'item' },
                      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: T.secondary, fontSize: 12 } },
                      series: [
                        {
                          type: 'pie',
                          radius: ['45%', '72%'],
                          center: ['32%', '50%'],
                          label: { show: false },
                          data: d.byType.map((it, i) => ({
                            name: it.name,
                            value: it.value,
                            itemStyle: { color: [T.primary, T.secondaryFixedDim, '#727577', T.primaryFixed, T.surfaceVariant, T.orange][i % 6] },
                          })),
                        },
                      ],
                    }}
                  />
                )}
              </div>
              <Table
                size="small"
                rowKey={(r) => r.productName + r.specText}
                dataSource={d.lowStock}
                pagination={false}
                locale={{ emptyText: t('没有低库存规格 👍', 'No low-stock SKUs 👍') }}
                columns={[
                  { title: t('低库存规格', 'Low-stock SKU'), render: (_, r) => `${r.productName}${r.specText ? `（${r.specText}）` : ''}` },
                  { title: t('库存', 'Stock'), dataIndex: 'stock', width: 80, render: (v) => <b style={{ color: T.error }}>{fmtQty(v)}</b> },
                  { title: t('预警线', 'Alert level'), dataIndex: 'minQuantity', width: 80, render: (v) => fmtQty(v) },
                ]}
              />
            </div>
          )}
        </Body>
      </Card>

      {/* 进货统计 */}
      <Card title={t('进货统计', 'Purchase stats')}>
        <Body data={purchase.data} error={purchase.error}>
          {(d) =>
            d.orderCount === 0 ? (
              <Typography.Text type="secondary">{t('这段时间没有进货', 'No purchases in this period')}</Typography.Text>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 16, marginBottom: 14 }}>
                  {stat(t('进货总额', 'Purchase total'), d.total)}
                  {stat(t('进货单数', 'Purchase orders'), d.orderCount, false)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  <Table
                    size="small"
                    rowKey="name"
                    title={() => t('按商品', 'By product')}
                    dataSource={d.byProduct.slice(0, 8)}
                    pagination={false}
                    columns={[
                      { title: t('商品', 'Product'), dataIndex: 'name' },
                      { title: t('数量', 'Qty'), dataIndex: 'qty', width: 70, render: (v) => fmtQty(v) },
                      { title: t('金额', 'Amount'), dataIndex: 'amount', width: 90, render: (v) => fmtMoney(v) },
                    ]}
                  />
                  <Table
                    size="small"
                    rowKey="name"
                    title={() => t('按供应商', 'By supplier')}
                    dataSource={d.bySupplier}
                    pagination={false}
                    columns={[
                      { title: t('供应商', 'Supplier'), dataIndex: 'name' },
                      { title: t('单数', 'Orders'), dataIndex: 'orders', width: 70 },
                      { title: t('金额', 'Amount'), dataIndex: 'amount', width: 90, render: (v) => fmtMoney(v) },
                    ]}
                  />
                </div>
              </>
            )
          }
        </Body>
      </Card>

      {/* 资金流水（仅老板）*/}
      {isAdmin && (
        <Card title={t('资金流水', 'Cash flow')} extra={<Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('退货冲账不算真钱，已排除', 'Return write-offs are not real cash and are excluded')}</Typography.Text>}>
          <Body data={cash.data} error={cash.error}>
            {(d) => (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 220px))', gap: 16, marginBottom: 14 }}>
                  {stat(t('流入', 'Inflow'), d.inflow, true, T.emerald)}
                  {stat(t('流出', 'Outflow'), d.outflow, true, T.error)}
                  {stat(t('净额', 'Net'), d.net, true, d.net >= 0 ? T.emerald : T.error)}
                </div>
                <Table
                  size="small"
                  rowKey="_k"
                  dataSource={d.rows.slice(0, 20).map((r, i) => ({ ...r, _k: i }))}
                  pagination={false}
                  locale={{ emptyText: t('这段时间没有资金往来', 'No cash movements in this period') }}
                  columns={[
                    { title: t('时间', 'Time'), dataIndex: 'at', width: 150, render: (v) => dayjs(v).format('MM-DD HH:mm') },
                    { title: t('类型', 'Type'), dataIndex: 'type', width: 70 },
                    {
                      title: t('金额', 'Amount'),
                      dataIndex: 'amount',
                      width: 110,
                      render: (v: number) => (
                        <b style={{ color: v >= 0 ? T.emerald : T.error }}>
                          {v >= 0 ? '+' : ''}
                          {fmtMoney(v)}
                        </b>
                      ),
                    },
                    { title: t('账户', 'Account'), dataIndex: 'account', width: 90, render: (v) => v ?? '-' },
                    { title: t('备注', 'Note'), dataIndex: 'note', ellipsis: true, render: (v) => v ?? '-' },
                  ]}
                />
                {d.rows.length > 20 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t(
                      `只显示最近 20 条（区间内共 ${d.rows.length} 条）`,
                      `Showing the latest 20 of ${d.rows.length} records in this period`,
                    )}
                  </Typography.Text>
                )}
              </>
            )}
          </Body>
        </Card>
      )}

      {/* 员工业绩（仅老板）*/}
      {isAdmin && (
        <Card title={t('员工业绩', 'Staff performance')}>
          <Body data={staff.data} error={staff.error}>
            {(d) => (
              <Table
                size="small"
                rowKey="name"
                dataSource={d.list}
                pagination={false}
                locale={{ emptyText: t('这段时间没有成交订单', 'No completed orders in this period') }}
                columns={[
                  { title: t('员工', 'Staff'), dataIndex: 'name' },
                  { title: t('订单数', 'Orders'), dataIndex: 'orders', width: 90 },
                  { title: t('销售额', 'Revenue'), dataIndex: 'sales', width: 110, render: (v) => fmtMoney(v) },
                  { title: t('毛利', 'Gross profit'), dataIndex: 'profit', width: 110, render: (v) => fmtMoney(v) },
                ]}
              />
            )}
          </Body>
        </Card>
      )}
    </div>
  )
}
