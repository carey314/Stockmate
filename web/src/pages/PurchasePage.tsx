import {
  App,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { fmtMoney, fmtQty, fmtTime } from '../lib/format'
import { T, cardStyle } from '../theme'

interface POItem {
  id: number
  productName: string
  specText: string | null
  quantity: number
  returnedQty: number
  unitPrice: number
  subtotal: number
}
interface PORow {
  id: number
  orderNo: string
  status: 'completed' | 'cancelled'
  totalAmount: number
  discountAmount: number
  actualAmount: number
  paidAmount: number
  unpaidAmount: number
  settlementAccount: string | null
  notes: string | null
  createdAt: string
  supplier: { id: number; name: string } | null
  _count?: { items: number }
}
interface PODetail extends PORow {
  items: POItem[]
  operator: { realName: string } | null
}
interface Supplier {
  id: number
  name: string
}
interface SkuOption {
  skuId: number
  label: string
  costPrice: number | null
}

const ACCOUNTS = ['现金', '微信', '支付宝', '银行卡', '挂账']
type Filter = 'all' | 'unpaid' | 'cancelled'

// 建单里的一行
interface Line {
  skuId: number
  name: string
  quantity: number
  unitPrice: number
}

export default function PurchasePage() {
  const { message } = App.useApp()
  // 筛选进 URL（与订单页同构）：刷新/分享不丢视图
  const [urlParams, setUrlParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>(() => {
    const s = urlParams.get('status')
    return s === 'unpaid' || s === 'cancelled' ? s : 'all'
  })
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(() => {
    const f = urlParams.get('from')
    const t = urlParams.get('to')
    return f && t && dayjs(f).isValid() && dayjs(t).isValid() ? [dayjs(f), dayjs(t)] : null
  })
  const [kw, setKw] = useState(() => urlParams.get('kw') ?? '') // 模糊查单号/供应商
  useEffect(() => {
    setUrlParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (filter === 'all') p.delete('status')
        else p.set('status', filter)
        if (range) {
          p.set('from', range[0].format('YYYY-MM-DD'))
          p.set('to', range[1].format('YYYY-MM-DD'))
        } else {
          p.delete('from')
          p.delete('to')
        }
        if (kw) p.set('kw', kw)
        else p.delete('kw')
        return p
      },
      { replace: true },
    )
  }, [filter, range, kw, setUrlParams])
  const [rows, setRows] = useState<PORow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [skuOpts, setSkuOpts] = useState<SkuOption[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ list: PORow[]; pagination: { total: number } }>('/purchase-orders', {
        page,
        pageSize,
        ...(filter === 'unpaid' ? { unpaidOnly: 1 } : {}),
        ...(filter === 'cancelled' ? { status: 'cancelled' } : {}),
        ...(range ? { startDate: range[0].format('YYYY-MM-DD'), endDate: range[1].format('YYYY-MM-DD') } : {}),
        ...(kw ? { keyword: kw } : {}),
      })
      // 后端 unpaidOnly 是取完当页再 filter，前端 cancelled 也可能混入；按当前筛选二次收敛显示
      let list = data.list
      if (filter === 'cancelled') list = list.filter((o) => o.status === 'cancelled')
      setRows(list)
      setTotal(data.pagination.total)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filter, range, kw, message])
  useEffect(() => {
    load()
  }, [load])

  // 建单要用的供应商 + SKU 选项
  useEffect(() => {
    api.get<{ list: Supplier[] }>('/suppliers', { pageSize: 200 }).then((d) => setSuppliers(d.list)).catch(() => {})
    api
      .get<{ list: { id: number; name: string; skus: { id: number; specText: string; costPrice: number | null }[] }[] }>('/products', { pageSize: 500 })
      .then((d) => {
        const opts: SkuOption[] = []
        for (const p of d.list) for (const s of p.skus) opts.push({ skuId: s.id, label: `${p.name}${s.specText ? ` ${s.specText}` : ''}`, costPrice: s.costPrice })
        setSkuOpts(opts)
      })
      .catch(() => {})
  }, [])

  // ===== 详情 =====
  const [detail, setDetail] = useState<PODetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const openDetail = async (id: number) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      setDetail(await api.get<PODetail>(`/purchase-orders/${id}`))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setDetailLoading(false)
    }
  }
  const refreshAll = (id?: number) => {
    load()
    if (id) openDetail(id)
  }

  // 深链 /purchase?id=xx：收益日历等页跳过来直接打开该单详情（只清 id，保留筛选参数）
  useEffect(() => {
    const id = Number(urlParams.get('id'))
    if (id) {
      openDetail(id)
      setUrlParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          p.delete('id')
          return p
        },
        { replace: true },
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ===== 建单 =====
  const [createOpen, setCreateOpen] = useState(false)
  const [supplierId, setSupplierId] = useState<number | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [paid, setPaid] = useState<number | null>(null)
  const [account, setAccount] = useState('现金')
  const [notes, setNotes] = useState('')
  const [createBusy, setCreateBusy] = useState(false)

  const linesTotal = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0), [lines])

  const addLine = (skuId: number) => {
    if (lines.some((l) => l.skuId === skuId)) return
    const opt = skuOpts.find((o) => o.skuId === skuId)
    if (!opt) return
    setLines((p) => [...p, { skuId, name: opt.label, quantity: 1, unitPrice: opt.costPrice ?? 0 }])
  }
  const patchLine = (skuId: number, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.skuId === skuId ? { ...l, ...p } : l)))
  const removeLine = (skuId: number) => setLines((prev) => prev.filter((l) => l.skuId !== skuId))

  const resetCreate = () => {
    setSupplierId(null)
    setLines([])
    setPaid(null)
    setAccount('现金')
    setNotes('')
  }
  const submitCreate = async () => {
    if (lines.length === 0) return message.warning('至少加一件商品')
    if (lines.some((l) => l.quantity <= 0)) return message.warning('数量要大于 0')
    setCreateBusy(true)
    try {
      await api.post('/purchase-orders', {
        supplierId: supplierId ?? null,
        items: lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity, unitPrice: l.unitPrice })),
        paidAmount: paid ?? undefined,
        settlementAccount: account,
        notes: notes.trim() || null,
      })
      message.success('进货单已建，库存已入库')
      setCreateOpen(false)
      resetCreate()
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  // ===== 付款 =====
  const [payOpen, setPayOpen] = useState(false)
  const [payForm] = Form.useForm()
  const [payBusy, setPayBusy] = useState(false)
  const doPay = async () => {
    if (!detail) return
    const v = await payForm.validateFields()
    setPayBusy(true)
    try {
      await api.post(`/purchase-orders/${detail.id}/pay`, { amount: v.amount, settlementAccount: v.account })
      message.success('已付款')
      setPayOpen(false)
      payForm.resetFields()
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setPayBusy(false)
    }
  }

  // ===== 退货给供应商 =====
  const [retOpen, setRetOpen] = useState(false)
  const [retQty, setRetQty] = useState<Record<number, number>>({})
  const [retAccount, setRetAccount] = useState('现金')
  const [retBusy, setRetBusy] = useState(false)
  const doReturn = async () => {
    if (!detail) return
    const items = Object.entries(retQty)
      .filter(([, q]) => q > 0)
      .map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity }))
    if (items.length === 0) return message.warning('填要退的数量')
    setRetBusy(true)
    try {
      await api.post(`/purchase-orders/${detail.id}/return`, { items, account: retAccount })
      message.success('已退货给供应商')
      setRetOpen(false)
      setRetQty({})
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setRetBusy(false)
    }
  }

  const doCancel = async () => {
    if (!detail) return
    try {
      await api.put(`/purchase-orders/${detail.id}/cancel`)
      message.success('进货单已作废，库存已扣回')
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns: ColumnsType<PORow> = [
    { title: '单号', dataIndex: 'orderNo', render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: '供应商', render: (_, o) => o.supplier?.name ?? '无供应商' },
    { title: '进货额', dataIndex: 'actualAmount', width: 100, render: (v) => fmtMoney(v) },
    {
      title: '欠供应商',
      dataIndex: 'unpaidAmount',
      width: 110,
      render: (v: number) => (v > 0 ? <b style={{ color: T.error }}>{fmtMoney(v)}</b> : <span style={{ color: T.emerald }}>已付清</span>),
    },
    { title: '状态', dataIndex: 'status', width: 80, render: (s) => (s === 'cancelled' ? <Tag>已作废</Tag> : <Tag color="green">已完成</Tag>) },
    { title: '时间', dataIndex: 'createdAt', width: 130, render: (v) => fmtTime(v) },
    {
      title: '操作',
      key: 'ops',
      width: 90,
      fixed: 'right',
      render: (_, o) => (
        <Button size="small" type="link" onClick={() => openDetail(o.id)}>
          详情
        </Button>
      ),
    },
  ]

  const canReturn = detail?.status === 'completed' && detail.items.some((i) => i.quantity - i.returnedQty > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['all', '全部'], ['unpaid', '欠供应商'], ['cancelled', '已作废']] as [Filter, string][]).map(([k, label]) => (
            <span
              key={k}
              onClick={() => {
                setFilter(k)
                setPage(1)
              }}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: filter === k ? T.surfaceContainerLow : 'transparent',
                color: filter === k ? T.primary : T.secondary,
                border: filter === k ? `1px solid ${T.primary}33` : '1px solid transparent',
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)
            setPage(1)
          }}
        />
        <Input.Search
          placeholder="搜单号 / 供应商"
          allowClear
          defaultValue={kw}
          onSearch={(v) => {
            setKw(v.trim())
            setPage(1)
          }}
          style={{ width: 200 }}
        />
        <Button type="primary" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }} onClick={() => setCreateOpen(true)}>
          新建进货单
        </Button>
      </div>

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<PORow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description="还没有进货单，新建一个把进的货录进来" /> }}
          onRow={(o) => ({ onClick: () => openDetail(o.id), style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 单`,
            onChange: (p, ps) => {
              setPage(p)
              setPageSize(ps)
            },
          }}
          scroll={{ x: 720 }}
        />
      </div>

      {/* 建单 */}
      <Modal
        title="新建进货单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        confirmLoading={createBusy}
        okText="确认进货（自动入库）"
        width={720}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <Select
            allowClear
            showSearch
            placeholder="选供应商（可不选）"
            value={supplierId}
            onChange={(v) => setSupplierId(v ?? null)}
            optionFilterProp="label"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            style={{ width: 220 }}
          />
          <Select<number>
            showSearch
            placeholder="加商品：搜名称/规格"
            value={null}
            onChange={(v) => v != null && addLine(v)}
            optionFilterProp="label"
            options={skuOpts.filter((o) => !lines.some((l) => l.skuId === o.skuId)).map((o) => ({ value: o.skuId, label: o.label }))}
            style={{ flex: 1, minWidth: 240 }}
          />
        </div>
        {lines.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上面搜商品加进来，填数量和进价" />
        ) : (
          <Table<Line>
            rowKey="skuId"
            size="small"
            dataSource={lines}
            pagination={false}
            columns={[
              { title: '商品', dataIndex: 'name' },
              {
                title: '进价',
                width: 110,
                render: (_, l) => (
                  <InputNumber size="small" prefix="¥" min={0} precision={2} value={l.unitPrice} onChange={(v) => patchLine(l.skuId, { unitPrice: v ?? 0 })} style={{ width: 96 }} />
                ),
              },
              {
                title: '数量',
                width: 100,
                render: (_, l) => (
                  <InputNumber size="small" min={0} value={l.quantity} onChange={(v) => patchLine(l.skuId, { quantity: v ?? 0 })} style={{ width: 88 }} />
                ),
              },
              { title: '小计', width: 90, render: (_, l) => fmtMoney(l.quantity * l.unitPrice) },
              { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.skuId)} /> },
            ]}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            合计 <b style={{ fontSize: 16 }}>{fmtMoney(linesTotal)}</b>
          </span>
          <span>
            已付
            <InputNumber
              size="small"
              prefix="¥"
              min={0}
              precision={2}
              max={linesTotal}
              placeholder={String(linesTotal)}
              value={paid}
              onChange={(v) => setPaid(v)}
              style={{ width: 110, marginLeft: 6 }}
            />
          </span>
          <Select size="small" value={account} onChange={setAccount} options={ACCOUNTS.map((a) => ({ value: a, label: a }))} style={{ width: 100 }} />
        </div>
        {paid !== null && paid < linesTotal && (
          <div style={{ textAlign: 'right', marginTop: 6, fontSize: 12, color: T.error }}>
            欠供应商 {fmtMoney(linesTotal - paid)}
          </div>
        )}
        <Input.TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="备注（选填）" autoSize={{ minRows: 1, maxRows: 2 }} style={{ marginTop: 10 }} maxLength={200} />
      </Modal>

      {/* 详情 */}
      <Drawer open={!!detail || detailLoading} onClose={() => setDetail(null)} size="large" title={detail ? `进货单 ${detail.orderNo}` : '加载中'} className="print-area">
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span>
                供应商：<b>{detail.supplier?.name ?? '无供应商'}</b>
              </span>
              <span style={{ color: T.secondary }}>
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')} · {detail.operator?.realName ?? ''}
              </span>
            </div>
            {detail.status === 'cancelled' && <Tag style={{ marginBottom: 12 }}>此单已作废</Tag>}
            <Table<POItem>
              rowKey="id"
              size="small"
              dataSource={detail.items}
              pagination={false}
              columns={[
                {
                  title: '商品',
                  render: (_, it) => (
                    <span>
                      {it.productName}
                      {it.specText ? <span style={{ color: T.secondary }}>（{it.specText}）</span> : ''}
                      {it.returnedQty > 0 && <Tag color="orange" style={{ marginLeft: 6 }}>已退{fmtQty(it.returnedQty)}</Tag>}
                    </span>
                  ),
                },
                { title: '进价', dataIndex: 'unitPrice', width: 72, render: (v) => fmtMoney(v) },
                { title: '数量', dataIndex: 'quantity', width: 56, render: (v) => fmtQty(v) },
                { title: '小计', dataIndex: 'subtotal', width: 80, render: (v) => fmtMoney(v) },
              ]}
            />
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <PORowLine label="原价合计" value={fmtMoney(detail.totalAmount)} />
              {detail.discountAmount > 0 && <PORowLine label="折扣" value={`- ${fmtMoney(detail.discountAmount)}`} />}
              <PORowLine label="进货额" value={fmtMoney(detail.actualAmount)} bold />
              <PORowLine label="已付" value={fmtMoney(detail.paidAmount)} />
              {detail.unpaidAmount > 0 && <PORowLine label="欠供应商" value={fmtMoney(detail.unpaidAmount)} danger bold />}
              {detail.settlementAccount && <PORowLine label="结算" value={detail.settlementAccount} />}
            </div>
            {detail.status === 'completed' && (
              <div className="no-print" style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail.unpaidAmount > 0 && (
                  <Button type="primary" onClick={() => { payForm.setFieldsValue({ amount: detail.unpaidAmount, account: '现金' }); setPayOpen(true) }}>
                    付款
                  </Button>
                )}
                {canReturn && <Button onClick={() => { setRetQty({}); setRetOpen(true) }}>退货给供应商</Button>}
                <Popconfirm title="作废这单？库存会扣回、应付一并冲销" onConfirm={doCancel}>
                  <Button danger>作废</Button>
                </Popconfirm>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 付款 */}
      <Modal title="付货款" open={payOpen} onCancel={() => setPayOpen(false)} onOk={doPay} confirmLoading={payBusy} okText="确认付款">
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="付款金额" rules={[{ required: true, message: '填金额' }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" min={0.01} precision={2} max={detail?.unpaidAmount} />
          </Form.Item>
          <Form.Item name="account" label="付款方式">
            <Select options={ACCOUNTS.filter((a) => a !== '挂账').map((a) => ({ value: a, label: a }))} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前欠供应商 {detail ? fmtMoney(detail.unpaidAmount) : ''}，可分次付
          </Typography.Text>
        </Form>
      </Modal>

      {/* 退货 */}
      <Modal title="退货给供应商" open={retOpen} onCancel={() => setRetOpen(false)} onOk={doReturn} confirmLoading={retBusy} okText="确认退货" width={520}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          填每个商品要退的数量（不超过可退数）。退货会扣回库存、冲减应付。
        </Typography.Paragraph>
        {detail?.items.map((it) => {
          const returnable = it.quantity - it.returnedQty
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                {it.productName}
                {it.specText ? `（${it.specText}）` : ''}
                <span style={{ color: T.secondary }}> 可退 {fmtQty(returnable)}</span>
              </span>
              <InputNumber size="small" min={0} max={returnable} disabled={returnable <= 0} value={retQty[it.id] ?? 0} onChange={(v) => setRetQty((p) => ({ ...p, [it.id]: v ?? 0 }))} style={{ width: 90 }} />
            </div>
          )
        })}
        <div style={{ marginTop: 12 }}>
          退款方式：
          <Select size="small" value={retAccount} onChange={setRetAccount} options={ACCOUNTS.filter((a) => a !== '挂账').map((a) => ({ value: a, label: a }))} style={{ width: 120, marginLeft: 8 }} />
        </div>
      </Modal>
    </div>
  )
}

function PORowLine({ label, value, bold, danger }: { label: string; value: string; bold?: boolean; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: T.secondary }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: danger ? T.error : T.onSurface }}>{value}</span>
    </div>
  )
}
