import {
  App,
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import api from '../api/client'
import { fmtQty, fmtTime } from '../lib/format'
import { T, cardStyle } from '../theme'

// ===== 类型（严格对齐 stocktakes 控制器契约）=====
interface ProductType {
  id: number
  name: string
}
interface StocktakeRow {
  id: number
  orderNo: string
  productTypeId: number | null
  totalItems: number
  diffItems: number
  gainQty: number // 盘盈总数
  lossQty: number // 盘亏总数
  notes: string | null
  createdAt: string
}
interface StocktakeItem {
  id: number
  skuId: number
  productName: string
  specText: string | null
  systemQty: number // 账面
  actualQty: number // 实盘
  diff: number // 实盘-账面，正=盘盈 负=盘亏
}
interface StocktakeDetail extends StocktakeRow {
  operator: { realName: string } | null
  items: StocktakeItem[]
}

// 新建盘点时拉商品用（只取到 sku + 库存）
interface ProductSku {
  id: number
  specText: string
  inventory: { quantity: number } | null
}
interface ProductRow {
  id: number
  name: string
  unit: string
  skus: ProductSku[]
}

// 新建盘点面板里，每个 SKU 平铺成一行
interface SheetRow {
  skuId: number
  productName: string
  specText: string
  unit: string
  systemQty: number // 账面库存（只读）
  actualQty: number // 实盘（默认预填账面，用户改）
}

const diffColor = (n: number) => (n > 0 ? T.emerald : n < 0 ? T.error : T.secondary)

export default function StocktakePage() {
  const { message } = App.useApp()

  const [types, setTypes] = useState<ProductType[]>([])
  const typeName = useMemo(() => {
    const m = new Map<number, string>()
    types.forEach((t) => m.set(t.id, t.name))
    return m
  }, [types])

  const [rows, setRows] = useState<StocktakeRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)

  // ===== 列表加载（注意：/stocktakes 返回 {total, list}，不是 {list, pagination}）=====
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ total: number; list: StocktakeRow[] }>('/stocktakes', {
        page,
        pageSize,
      })
      setRows(data.list)
      setTotal(data.total)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, message])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    api
      .get<ProductType[] | { list: ProductType[] }>('/product-types')
      .then((d) => setTypes(Array.isArray(d) ? d : d.list))
      .catch(() => {})
  }, [])

  // ===== 详情抽屉 =====
  const [detail, setDetail] = useState<StocktakeDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const openDetail = async (id: number) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      setDetail(await api.get<StocktakeDetail>(`/stocktakes/${id}`))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }

  // ===== 新建盘点 =====
  const [createOpen, setCreateOpen] = useState(false)
  const [scopeType, setScopeType] = useState<number | 'all'>('all')
  const [notes, setNotes] = useState('')
  const [sheet, setSheet] = useState<SheetRow[]>([])
  const [sheetLoading, setSheetLoading] = useState(false)
  const [submitBusy, setSubmitBusy] = useState(false)

  // 按范围拉在售 SKU，flatten 成行（参考 ProductsPage 的 skus 展开写法）
  const loadSheet = useCallback(
    async (scope: number | 'all') => {
      setSheetLoading(true)
      try {
        const data = await api.get<{ list: ProductRow[]; pagination: { total: number } }>('/products', {
          page: 1,
          pageSize: 500,
          ...(typeof scope === 'number' ? { productTypeId: scope } : {}),
        })
        const flat: SheetRow[] = []
        for (const p of data.list) {
          for (const s of p.skus) {
            const sys = s.inventory?.quantity ?? 0
            flat.push({
              skuId: s.id,
              productName: p.name,
              specText: s.specText,
              unit: p.unit,
              systemQty: sys,
              actualQty: sys, // 默认预填账面数，用户改成实际清点数
            })
          }
        }
        setSheet(flat)
      } catch (e) {
        message.error((e as Error).message)
        setSheet([])
      } finally {
        setSheetLoading(false)
      }
    },
    [message],
  )

  const openCreate = () => {
    setScopeType('all')
    setNotes('')
    setSheet([])
    setCreateOpen(true)
    loadSheet('all')
  }

  const onScopeChange = (v: number | 'all') => {
    setScopeType(v)
    loadSheet(v)
  }

  const setActual = (skuId: number, v: number) => {
    setSheet((prev) => prev.map((r) => (r.skuId === skuId ? { ...r, actualQty: v } : r)))
  }

  const submit = async () => {
    if (sheet.length === 0) return message.warning('该范围没有可盘点的规格')
    setSubmitBusy(true)
    try {
      await api.post('/stocktakes', {
        productTypeId: scopeType === 'all' ? null : scopeType,
        notes: notes.trim() || undefined,
        items: sheet.map((r) => ({ skuId: r.skuId, actualQty: r.actualQty })),
      })
      message.success('盘点已提交，差异已自动调整库存并留流水')
      setCreateOpen(false)
      setPage(1)
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSubmitBusy(false)
    }
  }

  // ===== 列表列 =====
  const columns: ColumnsType<StocktakeRow> = [
    { title: '单号', dataIndex: 'orderNo', render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    {
      title: '盘点范围',
      dataIndex: 'productTypeId',
      width: 120,
      render: (v: number | null) =>
        v == null ? <span style={{ color: T.secondary }}>全部</span> : typeName.get(v) ?? `品类#${v}`,
    },
    { title: '盘了几项', dataIndex: 'totalItems', width: 90, align: 'center', render: (v) => fmtQty(v) },
    {
      title: '差异项',
      dataIndex: 'diffItems',
      width: 80,
      align: 'center',
      render: (v: number) => (v > 0 ? <b style={{ color: T.orange }}>{fmtQty(v)}</b> : <span style={{ color: T.secondary }}>0</span>),
    },
    {
      title: '盘盈',
      dataIndex: 'gainQty',
      width: 80,
      align: 'right',
      render: (v: number) => (v > 0 ? <span style={{ color: T.emerald }}>+{fmtQty(v)}</span> : <span style={{ color: T.secondary }}>-</span>),
    },
    {
      title: '盘亏',
      dataIndex: 'lossQty',
      width: 80,
      align: 'right',
      render: (v: number) => (v > 0 ? <span style={{ color: T.error }}>-{fmtQty(v)}</span> : <span style={{ color: T.secondary }}>-</span>),
    },
    { title: '时间', dataIndex: 'createdAt', width: 130, render: (v) => fmtTime(v) },
    {
      title: '操作',
      key: 'ops',
      width: 80,
      fixed: 'right',
      render: (_, r) => (
        <Button size="small" type="link" onClick={() => openDetail(r.id)}>
          详情
        </Button>
      ),
    },
  ]

  const changedCount = sheet.filter((r) => r.actualQty !== r.systemQty).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建盘点
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          盘点 = 清点实物数量，提交后差异自动调整库存并留流水
        </Typography.Text>
      </div>

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<StocktakeRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description="还没有盘点记录，点「新建盘点」开始第一次清点" /> }}
          onRow={(r) => ({ onClick: () => openDetail(r.id), style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 张盘点单`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
          scroll={{ x: 760 }}
        />
      </div>

      {/* 详情抽屉 */}
      <Drawer
        open={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        size="large"
        title={detail ? `盘点单 ${detail.orderNo}` : '加载中'}
      >
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span>
                范围：<b>{detail.productTypeId == null ? '全部' : typeName.get(detail.productTypeId) ?? `品类#${detail.productTypeId}`}</b>
              </span>
              <span style={{ color: T.secondary }}>
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')} · {detail.operator?.realName ?? ''}
              </span>
            </div>
            {detail.notes && (
              <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
                备注：{detail.notes}
              </Typography.Paragraph>
            )}
            <Table<StocktakeItem>
              rowKey="id"
              size="small"
              dataSource={detail.items}
              pagination={false}
              locale={{ emptyText: <Empty description="无明细" /> }}
              columns={[
                {
                  title: '商品',
                  render: (_, it) => (
                    <span>
                      {it.productName}
                      {it.specText ? <span style={{ color: T.secondary }}>（{it.specText}）</span> : ''}
                    </span>
                  ),
                },
                { title: '账面', dataIndex: 'systemQty', width: 70, align: 'right', render: (v) => fmtQty(v) },
                { title: '实盘', dataIndex: 'actualQty', width: 70, align: 'right', render: (v) => fmtQty(v) },
                {
                  title: '差异',
                  dataIndex: 'diff',
                  width: 80,
                  align: 'right',
                  render: (v: number) => (
                    <span style={{ color: diffColor(v), fontWeight: v !== 0 ? 700 : 400 }}>
                      {v > 0 ? `+${fmtQty(v)}` : fmtQty(v)}
                    </span>
                  ),
                },
              ]}
            />
            <div style={{ marginTop: 16, display: 'flex', gap: 24, fontSize: 14 }}>
              <span>
                <span style={{ color: T.secondary }}>盘盈合计 </span>
                <b style={{ color: T.emerald }}>+{fmtQty(detail.gainQty)}</b>
              </span>
              <span>
                <span style={{ color: T.secondary }}>盘亏合计 </span>
                <b style={{ color: T.error }}>-{fmtQty(detail.lossQty)}</b>
              </span>
            </div>
          </div>
        )}
      </Drawer>

      {/* 新建盘点 Modal */}
      <Modal
        title="新建盘点"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submit}
        confirmLoading={submitBusy}
        okText="提交盘点"
        okButtonProps={{ disabled: sheet.length === 0 }}
        width={760}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: T.secondary }}>盘点范围</span>
          <Select
            value={scopeType}
            onChange={onScopeChange}
            style={{ width: 200 }}
            options={[
              { value: 'all' as const, label: '全部商品' },
              ...types.map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            共 {sheet.length} 个规格
            {changedCount > 0 ? ` · ${changedCount} 项有差异` : ''}
          </Typography.Text>
        </div>

        <Table<SheetRow>
          rowKey="skuId"
          size="small"
          loading={sheetLoading}
          dataSource={sheet}
          pagination={false}
          scroll={{ y: 380 }}
          locale={{ emptyText: <Empty description="该范围没有可盘点的规格" /> }}
          columns={[
            {
              title: '商品',
              render: (_, r) => (
                <span>
                  {r.productName}
                  {r.specText ? <span style={{ color: T.secondary }}>（{r.specText}）</span> : ''}
                </span>
              ),
            },
            {
              title: '账面库存',
              dataIndex: 'systemQty',
              width: 110,
              align: 'right',
              render: (v: number, r) => (
                <span style={{ color: T.secondary }}>
                  {fmtQty(v)} {r.unit}
                </span>
              ),
            },
            {
              title: '实盘数',
              width: 130,
              render: (_, r) => (
                <InputNumber
                  size="small"
                  min={0}
                  value={r.actualQty}
                  onChange={(v) => setActual(r.skuId, v ?? 0)}
                  style={{ width: 110 }}
                />
              ),
            },
            {
              title: '差异',
              width: 90,
              align: 'right',
              render: (_, r) => {
                const d = r.actualQty - r.systemQty
                return (
                  <span
                    style={{
                      color: diffColor(d),
                      fontWeight: d !== 0 ? 700 : 400,
                      background: d !== 0 ? `${d > 0 ? T.emerald : T.error}14` : 'transparent',
                      padding: d !== 0 ? '2px 8px' : 0,
                      borderRadius: 999,
                    }}
                  >
                    {d > 0 ? `+${fmtQty(d)}` : d < 0 ? fmtQty(d) : '—'}
                  </span>
                )
              },
            },
          ]}
        />

        <div style={{ marginTop: 12 }}>
          <Input.TextArea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="备注（选填）：本次盘点的说明"
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>
      </Modal>
    </div>
  )
}
