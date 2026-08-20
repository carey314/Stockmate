import { Drawer, Table, Tag } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import api from '../api/client'
import { fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { T } from '../theme'

// 库存流水（该规格的完整变动史）——两端盘点时发现的共同缺口，Web 先补。
// 数据 GET /inventory/records?skuId=（后端现成，含前后库存与操作人）。
interface Rec {
  id: number
  type: string
  quantity: number
  beforeQuantity: number
  afterQuantity: number
  reason: string | null
  createdAt: string
  operator?: { realName: string } | null
}

const TYPE_META: Record<string, [string, string, string]> = {
  inbound: ['入库', 'In', 'green'],
  outbound: ['出库', 'Out', 'red'],
  adjust: ['调整', 'Adjust', 'blue'],
}

export default function SkuRecordsDrawer({
  sku,
  onClose,
}: {
  sku: { id: number; label: string } | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<Rec[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!sku) return
    setLoading(true)
    try {
      const d = await api.get<{ list: Rec[]; pagination: { total: number } }>('/inventory/records', {
        skuId: sku.id,
        page,
        pageSize: 20,
      })
      setRows(d.list)
      setTotal(d.pagination.total)
    } finally {
      setLoading(false)
    }
  }, [sku, page])

  useEffect(() => {
    setPage(1)
  }, [sku?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load()
  }, [load])

  return (
    <Drawer
      open={!!sku}
      onClose={onClose}
      width={640}
      title={sku ? t(`库存流水 · ${sku.label}`, `Stock history · ${sku.label}`) : ''}
    >
      <Table<Rec>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ current: page, pageSize: 20, total, onChange: setPage, showTotal: (n) => t(`共 ${n} 条`, `${n} records`) }}
        columns={[
          {
            title: t('时间', 'Time'),
            dataIndex: 'createdAt',
            width: 150,
            render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: t('类型', 'Type'),
            dataIndex: 'type',
            width: 76,
            render: (v: string) => {
              const m = TYPE_META[v] ?? [v, v, 'default']
              return <Tag color={m[2]} style={{ borderRadius: 999 }}>{t(m[0], m[1])}</Tag>
            },
          },
          {
            title: t('变动', 'Change'),
            key: 'delta',
            width: 150,
            render: (_, r) => {
              const delta = r.afterQuantity - r.beforeQuantity
              return (
                <span>
                  <b style={{ color: delta >= 0 ? T.emerald : T.error }}>
                    {delta >= 0 ? '+' : ''}
                    {fmtQty(delta)}
                  </b>
                  <span style={{ color: T.secondary, fontSize: 12 }}>
                    {' '}
                    （{fmtQty(r.beforeQuantity)} → {fmtQty(r.afterQuantity)}）
                  </span>
                </span>
              )
            },
          },
          { title: t('原因', 'Reason'), dataIndex: 'reason', render: (v) => v || '-' },
          {
            title: t('操作人', 'By'),
            dataIndex: ['operator', 'realName'],
            width: 90,
            render: (v) => v || '-',
          },
        ]}
      />
    </Drawer>
  )
}
