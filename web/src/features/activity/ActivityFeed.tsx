import { Button, Empty, Skeleton, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import api from '../../api/client'
import { fmtMoney, fmtQty, fmtTime } from '../../lib/format'
import { T } from '../../theme'
import { t } from '../../lib/i18n'

interface InvRecord {
  id: number
  type: string
  quantity: number
  beforeQuantity: number
  afterQuantity: number
  reason: string | null
  relatedOrderId: number | null
  relatedPurchaseOrderId: number | null
  createdAt: string
  product: { name: string; unit: string } | null
  sku: { specText: string } | null
  operator?: { realName: string } | null
}

interface OrderRow {
  id: number
  orderNo: string
  status: string
  actualAmount: number
  unpaidAmount: number
  createdAt: string
  customer: { name: string } | null
  _count: { items: number }
}

interface FeedItem {
  key: string
  time: string
  dot: string
  node: ReactNode
  operator?: string
}

const LOSS_WORDS = ['报损', '过期', '自用']

function buildFeed(records: InvRecord[], orders: OrderRow[]): FeedItem[] {
  const items: FeedItem[] = []
  // 同一笔销售在两个接口各有一条：丢弃 relatedOrderId 的库存流水，保留信息更全的订单条目
  for (const r of records.filter((r) => !r.relatedOrderId)) {
    const name = `${r.product?.name ?? '未知商品'}${r.sku?.specText ? `（${r.sku.specText}）` : ''}`
    const delta = r.afterQuantity - r.beforeQuantity
    const sign = delta >= 0 ? '+' : '-'
    const isLoss = r.type === 'outbound' && LOSS_WORDS.some((w) => (r.reason ?? '').includes(w))
    const dot =
      r.type === 'inbound' ? T.emerald : isLoss ? T.error : r.reason?.includes('盘点') ? T.primary : T.secondary
    items.push({
      key: `r${r.id}`,
      time: r.createdAt,
      dot,
      operator: r.operator?.realName,
      node: (
        <>
          {name} <b style={{ color: delta >= 0 ? T.emerald : isLoss ? T.error : T.onSurface }}>
            {sign}{fmtQty(Math.abs(delta))}{r.product?.unit ?? ''}
          </b>
          {r.reason ? <span style={{ color: T.secondary }}> · {r.reason}</span> : null}
        </>
      ),
    })
  }
  for (const o of orders.filter((o) => o.status === 'completed')) {
    const owed = o.unpaidAmount > 0
    items.push({
      key: `o${o.id}`,
      time: o.createdAt,
      dot: owed ? T.error : T.primary,
      node: (
        <>
          {o.customer?.name ?? '散客'} 开单 <span style={{ color: T.primary }}>{o.orderNo}</span>{' '}
          <b>{fmtMoney(o.actualAmount)}</b>
          <span style={{ color: T.secondary }}>（{o._count.items} 项）</span>
          {owed && <b style={{ color: T.error }}> 欠 {fmtMoney(o.unpaidAmount)}</b>}
        </>
      ),
    })
  }
  return items.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 12)
}

export default function ActivityFeed() {
  const [feed, setFeed] = useState<FeedItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [rec, ord] = await Promise.all([
        api.get<{ list: InvRecord[] }>('/inventory/records', { page: 1, pageSize: 15 }),
        api.get<{ list: OrderRow[] }>('/orders', { page: 1, pageSize: 10 }),
      ])
      setFeed(buildFeed(rec.list, ord.list))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <Typography.Text strong style={{ fontSize: 17 }}>
          {t('最近动态', 'Recent Activity')}
        </Typography.Text>
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          onClick={() => {
            setFeed(null)
            load()
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', paddingRight: 6, minHeight: 0 }}>
        {error ? (
          <div style={{ textAlign: 'center', paddingTop: 24 }}>
            <Typography.Text type="secondary">{error}</Typography.Text>
            <br />
            <Button size="small" style={{ marginTop: 8 }} onClick={load}>
              重试
            </Button>
          </div>
        ) : !feed ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : feed.length === 0 ? (
          <Empty description="还没有动态，去 App 上开第一单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          feed.map((it, i) => (
            <div key={it.key} style={{ position: 'relative', paddingLeft: 24, paddingBottom: 20 }}>
              {i < feed.length - 1 && (
                <span
                  style={{
                    position: 'absolute',
                    left: 5,
                    top: 14,
                    bottom: -6,
                    width: 1,
                    background: 'rgba(199, 196, 215, 0.6)',
                  }}
                />
              )}
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 5,
                  width: 11,
                  height: 11,
                  borderRadius: 999,
                  border: '2px solid #fff',
                  background: it.dot,
                  boxShadow: `0 0 6px ${it.dot}55`,
                }}
              />
              <div style={{ fontSize: 12, color: T.secondary, marginBottom: 3 }}>
                {fmtTime(it.time)}
                {it.operator ? ` · ${it.operator}` : ''}
              </div>
              <div style={{ fontSize: 13.5, lineHeight: '20px', color: T.onSurface }}>{it.node}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
