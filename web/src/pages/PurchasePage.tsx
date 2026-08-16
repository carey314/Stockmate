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
import { t } from '../lib/i18n'
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
// 账户值是落库数据（后端 settlementAccount），只翻显示名，值本身不动
const ACCOUNT_EN: Record<string, string> = {
  现金: 'Cash',
  微信: 'WeChat Pay',
  支付宝: 'Alipay',
  银行卡: 'Bank card',
  挂账: 'On credit',
}
const accountLabel = (a: string) => t(a, ACCOUNT_EN[a] ?? a)
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
    if (lines.length === 0) return message.warning(t('至少加一件商品', 'Add at least one product'))
    if (lines.some((l) => l.quantity <= 0)) return message.warning(t('数量要大于 0', 'Quantity must be greater than 0'))
    setCreateBusy(true)
    try {
      await api.post('/purchase-orders', {
        supplierId: supplierId ?? null,
        items: lines.map((l) => ({ skuId: l.skuId, quantity: l.quantity, unitPrice: l.unitPrice })),
        paidAmount: paid ?? undefined,
        settlementAccount: account,
        notes: notes.trim() || null,
      })
      message.success(t('进货单已建，库存已入库', 'Purchase order created, stock received'))
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
      message.success(t('已付款', 'Payment made'))
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
    if (items.length === 0) return message.warning(t('填要退的数量', 'Enter the quantity to return'))
    setRetBusy(true)
    try {
      await api.post(`/purchase-orders/${detail.id}/return`, { items, account: retAccount })
      message.success(t('已退货给供应商', 'Returned to supplier'))
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
      message.success(t('进货单已作废，库存已扣回', 'Purchase order voided, stock deducted'))
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns: ColumnsType<PORow> = [
    { title: t('单号', 'Order No.'), dataIndex: 'orderNo', render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: t('供应商', 'Supplier'), render: (_, o) => o.supplier?.name ?? t('无供应商', 'No supplier') },
    { title: t('进货额', 'Purchase amount'), dataIndex: 'actualAmount', width: 100, render: (v) => fmtMoney(v) },
    {
      title: t('欠供应商', 'Payable'),
      dataIndex: 'unpaidAmount',
      width: 110,
      render: (v: number) => (v > 0 ? <b style={{ color: T.error }}>{fmtMoney(v)}</b> : <span style={{ color: T.emerald }}>{t('已付清', 'Paid in full')}</span>),
    },
    {
      title: t('状态', 'Status'),
      dataIndex: 'status',
      width: 80,
      render: (s) => (s === 'cancelled' ? <Tag>{t('已作废', 'Voided')}</Tag> : <Tag color="green">{t('已完成', 'Completed')}</Tag>),
    },
    { title: t('时间', 'Time'), dataIndex: 'createdAt', width: 130, render: (v) => fmtTime(v) },
    {
      title: t('操作', 'Actions'),
      key: 'ops',
      width: 90,
      fixed: 'right',
      render: (_, o) => (
        <Button size="small" type="link" onClick={() => openDetail(o.id)}>
          {t('详情', 'Details')}
        </Button>
      ),
    },
  ]

  const canReturn = detail?.status === 'completed' && detail.items.some((i) => i.quantity - i.returnedQty > 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {([['all', t('全部', 'All')], ['unpaid', t('欠供应商', 'Payable')], ['cancelled', t('已作废', 'Voided')]] as [Filter, string][]).map(([k, label]) => (
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
          placeholder={t('搜单号 / 供应商', 'Search order no. / supplier')}
          allowClear
          defaultValue={kw}
          onSearch={(v) => {
            setKw(v.trim())
            setPage(1)
          }}
          style={{ width: 200 }}
        />
        <Button type="primary" icon={<PlusOutlined />} style={{ marginLeft: 'auto' }} onClick={() => setCreateOpen(true)}>
          {t('新建进货单', 'New purchase order')}
        </Button>
      </div>

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<PORow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{
            emptyText: (
              <Empty description={t('还没有进货单，新建一个把进的货录进来', 'No purchase orders yet — create one to record the goods you bought')} />
            ),
          }}
          onRow={(o) => ({ onClick: () => openDetail(o.id), style: { cursor: 'pointer' } })}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (n) => t(`共 ${n} 单`, `${n} orders`),
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
        title={t('新建进货单', 'New purchase order')}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        confirmLoading={createBusy}
        okText={t('确认进货（自动入库）', 'Confirm purchase (auto stock-in)')}
        width={720}
      >
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <Select
            allowClear
            showSearch
            placeholder={t('选供应商（可不选）', 'Select supplier (optional)')}
            value={supplierId}
            onChange={(v) => setSupplierId(v ?? null)}
            optionFilterProp="label"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            style={{ width: 220 }}
          />
          <Select<number>
            showSearch
            placeholder={t('加商品：搜名称/规格', 'Add product: search by name / spec')}
            value={null}
            onChange={(v) => v != null && addLine(v)}
            optionFilterProp="label"
            options={skuOpts.filter((o) => !lines.some((l) => l.skuId === o.skuId)).map((o) => ({ value: o.skuId, label: o.label }))}
            style={{ flex: 1, minWidth: 240 }}
          />
        </div>
        {lines.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t('上面搜商品加进来，填数量和进价', 'Search above to add products, then fill in quantity and cost')}
          />
        ) : (
          <Table<Line>
            rowKey="skuId"
            size="small"
            dataSource={lines}
            pagination={false}
            columns={[
              { title: t('商品', 'Product'), dataIndex: 'name' },
              {
                title: t('进价', 'Cost'),
                width: 110,
                render: (_, l) => (
                  <InputNumber size="small" prefix="¥" min={0} precision={2} value={l.unitPrice} onChange={(v) => patchLine(l.skuId, { unitPrice: v ?? 0 })} style={{ width: 96 }} />
                ),
              },
              {
                title: t('数量', 'Qty'),
                width: 100,
                render: (_, l) => (
                  <InputNumber size="small" min={0} value={l.quantity} onChange={(v) => patchLine(l.skuId, { quantity: v ?? 0 })} style={{ width: 88 }} />
                ),
              },
              { title: t('小计', 'Subtotal'), width: 90, render: (_, l) => fmtMoney(l.quantity * l.unitPrice) },
              { title: '', width: 40, render: (_, l) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeLine(l.skuId)} /> },
            ]}
          />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            {t('合计 ', 'Total ')}<b style={{ fontSize: 16 }}>{fmtMoney(linesTotal)}</b>
          </span>
          <span>
            {t('已付', 'Paid')}
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
          <Select size="small" value={account} onChange={setAccount} options={ACCOUNTS.map((a) => ({ value: a, label: accountLabel(a) }))} style={{ width: 100 }} />
        </div>
        {paid !== null && paid < linesTotal && (
          <div style={{ textAlign: 'right', marginTop: 6, fontSize: 12, color: T.error }}>
            {t(`欠供应商 ${fmtMoney(linesTotal - paid)}`, `Payable ${fmtMoney(linesTotal - paid)}`)}
          </div>
        )}
        <Input.TextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('备注（选填）', 'Notes (optional)')}
          autoSize={{ minRows: 1, maxRows: 2 }}
          style={{ marginTop: 10 }}
          maxLength={200}
        />
      </Modal>

      {/* 详情 */}
      <Drawer
        open={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        size="large"
        title={detail ? t(`进货单 ${detail.orderNo}`, `Purchase order ${detail.orderNo}`) : t('加载中', 'Loading')}
        className="print-area"
      >
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span>
                {t('供应商：', 'Supplier: ')}<b>{detail.supplier?.name ?? t('无供应商', 'No supplier')}</b>
              </span>
              <span style={{ color: T.secondary }}>
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')} · {detail.operator?.realName ?? ''}
              </span>
            </div>
            {detail.status === 'cancelled' && <Tag style={{ marginBottom: 12 }}>{t('此单已作废', 'This order has been voided')}</Tag>}
            <Table<POItem>
              rowKey="id"
              size="small"
              dataSource={detail.items}
              pagination={false}
              columns={[
                {
                  title: t('商品', 'Product'),
                  render: (_, it) => (
                    <span>
                      {it.productName}
                      {it.specText ? <span style={{ color: T.secondary }}>（{it.specText}）</span> : ''}
                      {it.returnedQty > 0 && (
                        <Tag color="orange" style={{ marginLeft: 6 }}>
                          {t(`已退${fmtQty(it.returnedQty)}`, `Returned ${fmtQty(it.returnedQty)}`)}
                        </Tag>
                      )}
                    </span>
                  ),
                },
                { title: t('进价', 'Cost'), dataIndex: 'unitPrice', width: 72, render: (v) => fmtMoney(v) },
                { title: t('数量', 'Qty'), dataIndex: 'quantity', width: 56, render: (v) => fmtQty(v) },
                { title: t('小计', 'Subtotal'), dataIndex: 'subtotal', width: 80, render: (v) => fmtMoney(v) },
              ]}
            />
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <PORowLine label={t('原价合计', 'Subtotal before discount')} value={fmtMoney(detail.totalAmount)} />
              {detail.discountAmount > 0 && <PORowLine label={t('折扣', 'Discount')} value={`- ${fmtMoney(detail.discountAmount)}`} />}
              <PORowLine label={t('进货额', 'Purchase amount')} value={fmtMoney(detail.actualAmount)} bold />
              <PORowLine label={t('已付', 'Paid')} value={fmtMoney(detail.paidAmount)} />
              {detail.unpaidAmount > 0 && <PORowLine label={t('欠供应商', 'Payable')} value={fmtMoney(detail.unpaidAmount)} danger bold />}
              {detail.settlementAccount && <PORowLine label={t('结算', 'Settlement account')} value={accountLabel(detail.settlementAccount)} />}
            </div>
            {detail.status === 'completed' && (
              <div className="no-print" style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail.unpaidAmount > 0 && (
                  <Button type="primary" onClick={() => { payForm.setFieldsValue({ amount: detail.unpaidAmount, account: '现金' }); setPayOpen(true) }}>
                    {t('付款', 'Pay')}
                  </Button>
                )}
                {canReturn && <Button onClick={() => { setRetQty({}); setRetOpen(true) }}>{t('退货给供应商', 'Return to supplier')}</Button>}
                <Popconfirm
                  title={t('作废这单？库存会扣回、应付一并冲销', 'Void this order? Stock will be deducted and the payable written off')}
                  onConfirm={doCancel}
                >
                  <Button danger>{t('作废', 'Void')}</Button>
                </Popconfirm>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 付款 */}
      <Modal
        title={t('付货款', 'Pay balance')}
        open={payOpen}
        onCancel={() => setPayOpen(false)}
        onOk={doPay}
        confirmLoading={payBusy}
        okText={t('确认付款', 'Confirm payment')}
      >
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label={t('付款金额', 'Payment amount')} rules={[{ required: true, message: t('填金额', 'Enter an amount') }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" min={0.01} precision={2} max={detail?.unpaidAmount} />
          </Form.Item>
          <Form.Item name="account" label={t('付款方式', 'Payment method')}>
            <Select options={ACCOUNTS.filter((a) => a !== '挂账').map((a) => ({ value: a, label: accountLabel(a) }))} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              `当前欠供应商 ${detail ? fmtMoney(detail.unpaidAmount) : ''}，可分次付`,
              `Payable ${detail ? fmtMoney(detail.unpaidAmount) : ''} — can be paid in instalments`,
            )}
          </Typography.Text>
        </Form>
      </Modal>

      {/* 退货 */}
      <Modal
        title={t('退货给供应商', 'Return to supplier')}
        open={retOpen}
        onCancel={() => setRetOpen(false)}
        onOk={doReturn}
        confirmLoading={retBusy}
        okText={t('确认退货', 'Confirm return')}
        width={520}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t(
            '填每个商品要退的数量（不超过可退数）。退货会扣回库存、冲减应付。',
            'Enter the quantity to return for each product (no more than the returnable amount). Returns deduct stock and offset the payable.',
          )}
        </Typography.Paragraph>
        {detail?.items.map((it) => {
          const returnable = it.quantity - it.returnedQty
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ flex: 1, fontSize: 13 }}>
                {it.productName}
                {it.specText ? `（${it.specText}）` : ''}
                <span style={{ color: T.secondary }}>{t(` 可退 ${fmtQty(returnable)}`, ` ${fmtQty(returnable)} returnable`)}</span>
              </span>
              <InputNumber size="small" min={0} max={returnable} disabled={returnable <= 0} value={retQty[it.id] ?? 0} onChange={(v) => setRetQty((p) => ({ ...p, [it.id]: v ?? 0 }))} style={{ width: 90 }} />
            </div>
          )
        })}
        <div style={{ marginTop: 12 }}>
          {t('退款方式：', 'Refund method: ')}
          <Select size="small" value={retAccount} onChange={setRetAccount} options={ACCOUNTS.filter((a) => a !== '挂账').map((a) => ({ value: a, label: accountLabel(a) }))} style={{ width: 120, marginLeft: 8 }} />
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
