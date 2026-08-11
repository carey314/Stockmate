import { Typography } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import api from '../api/client'
import { fmtQty } from '../lib/format'
import { T, cardStyle } from '../theme'

interface AlertRow {
  id: number
  quantity: number
  minQuantity: number
  sku: {
    id: number
    specText: string
    product: { id: number; name: string; unit: string }
  }
}

// 缺货预警卡：lowStockCount>0 时渲染（数据源 /inventory/alerts，裸数组不分页）
export default function RestockCard() {
  const [rows, setRows] = useState<AlertRow[] | null>(null)

  useEffect(() => {
    api.get<AlertRow[]>('/inventory/alerts').then(setRows).catch(() => setRows([]))
  }, [])

  if (!rows || rows.length === 0) return null

  return (
    <div style={{ ...cardStyle, padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <WarningOutlined style={{ color: T.error, fontSize: 18 }} />
        <Typography.Text strong style={{ fontSize: 17 }}>
          该补货了
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          {rows.length} 个规格低于预警线（去 App 一键开进货单）
        </Typography.Text>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
        {rows.map((r) => (
          <div
            key={r.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 14,
              background: 'rgba(255, 218, 214, 0.25)',
              fontSize: 13,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.sku.product.name}
              {r.sku.specText ? `（${r.sku.specText}）` : ''}
            </span>
            <span style={{ flexShrink: 0, marginLeft: 8 }}>
              <b style={{ color: T.error }}>{fmtQty(r.quantity)}</b>
              <span style={{ color: T.secondary }}>
                /{fmtQty(r.minQuantity)}
                {r.sku.product.unit}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
