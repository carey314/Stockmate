import {
  App,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Skeleton,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import api from '../api/client'
import { fmtMoney, fmtQty } from '../lib/format'
import { T, cardStyle } from '../theme'

type Mode = 'customer' | 'supplier'

interface Partner {
  id: number
  name: string
  contactPerson: string | null
  phone: string | null
  address: string | null
  notes: string | null
  productTypeId?: number | null
  owed?: number
  unpaidCount?: number
  createdAt: string
}
interface ProductType {
  id: number
  name: string
}
interface FrequentItem {
  skuId: number
  productName: string
  specText: string | null
  totalQty: number
  lastPrice: number
}
interface PriceRule {
  id: number
  skuId: number | null
  price: number
  product: { name: string; unit: string } | null
  sku: { specText: string | null } | null
}
interface SkuOpt {
  skuId: number
  label: string
}
interface UnpaidOrder {
  id: number
  orderNo: string
  actualAmount: number
  unpaidAmount: number
  createdAt: string
}

export default function PartnersPage() {
  const { message } = App.useApp()
  const [mode, setMode] = useState<Mode>('customer')
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<Partner[]>([])
  const [loading, setLoading] = useState(false)
  const [types, setTypes] = useState<ProductType[]>([])

  const isCustomer = mode === 'customer'

  useEffect(() => {
    api
      .get<ProductType[] | { list: ProductType[] }>('/product-types')
      .then((d) => setTypes(Array.isArray(d) ? d : d.list))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ list: Partner[] }>(isCustomer ? '/customers' : '/suppliers', {
        page: 1,
        pageSize: 200,
        ...(keyword ? { keyword } : {}),
      })
      // 客户和供应商都按欠款降序（催账/该付款的排前面）
      const list = [...data.list].sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0))
      setRows(list)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [isCustomer, keyword, message])

  useEffect(() => {
    load()
  }, [load])

  const totalOwed = rows.reduce((s, r) => s + (r.owed ?? 0), 0)
  const owedCount = rows.filter((r) => (r.owed ?? 0) > 0).length

  // ===== 增改 =====
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setEditOpen(true)
  }
  const openEdit = (p: Partner) => {
    setEditing(p)
    form.setFieldsValue(p)
    setEditOpen(true)
  }
  const submit = async () => {
    const v = await form.validateFields()
    setBusy(true)
    const base = isCustomer ? '/customers' : '/suppliers'
    const body = {
      name: v.name.trim(),
      contactPerson: v.contactPerson?.trim() || null,
      phone: v.phone?.trim() || null,
      address: v.address?.trim() || null,
      notes: v.notes?.trim() || null,
      ...(isCustomer ? { productTypeId: v.productTypeId ?? null } : {}),
    }
    try {
      if (editing) await api.put(`${base}/${editing.id}`, body)
      else await api.post(base, body)
      message.success(editing ? '已保存' : '已新建')
      setEditOpen(false)
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Partner) => {
    try {
      await api.delete(`${isCustomer ? '/customers' : '/suppliers'}/${p.id}`)
      message.success(`已删除「${p.name}」`)
      load()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  // ===== 客户展开：常买 + 专属价 + 未清单据 =====
  const [expandCache, setExpandCache] = useState<Record<number, { frequent: FrequentItem[]; prices: PriceRule[]; unpaid: UnpaidOrder[] } | 'loading'>>({})
  const loadExpand = (id: number, force = false) => {
    if (!force && expandCache[id]) return
    setExpandCache((p) => ({ ...p, [id]: 'loading' }))
    Promise.all([
      api.get<FrequentItem[]>(`/customers/${id}/frequent`).catch(() => []),
      api.get<PriceRule[]>(`/customers/${id}/prices`).catch(() => []),
      api.get<{ list: UnpaidOrder[] }>('/orders', { customerId: id, unpaidOnly: 1, pageSize: 50 }).then((d) => d.list).catch(() => []),
    ]).then(([frequent, prices, unpaid]) => setExpandCache((p) => ({ ...p, [id]: { frequent, prices, unpaid } })))
  }

  // 专属价可写：设价用的 SKU 选项（仅客户 tab 需要，懒拉一次）
  const [skuOpts, setSkuOpts] = useState<SkuOpt[]>([])
  const ensureSkuOpts = () => {
    if (skuOpts.length) return
    api
      .get<{ list: { name: string; skus: { id: number; specText: string }[] }[] }>('/products', { pageSize: 500 })
      .then((d) => {
        const opts: SkuOpt[] = []
        for (const p of d.list) for (const s of p.skus) opts.push({ skuId: s.id, label: `${p.name}${s.specText ? ` ${s.specText}` : ''}` })
        setSkuOpts(opts)
      })
      .catch(() => {})
  }

  // 设专属价 Modal
  const [priceTarget, setPriceTarget] = useState<Partner | null>(null)
  const [priceSkuId, setPriceSkuId] = useState<number | null>(null)
  const [priceValue, setPriceValue] = useState<number | null>(null)
  const [priceBusy, setPriceBusy] = useState(false)
  const openSetPrice = (p: Partner) => {
    ensureSkuOpts()
    setPriceTarget(p)
    setPriceSkuId(null)
    setPriceValue(null)
  }
  const submitPrice = async () => {
    if (!priceTarget) return
    if (!priceSkuId) return message.warning('先选商品')
    if (priceValue == null || priceValue < 0) return message.warning('填专属价')
    setPriceBusy(true)
    try {
      await api.post('/pricing', { skuId: priceSkuId, customerId: priceTarget.id, price: priceValue })
      message.success('已设专属价')
      loadExpand(priceTarget.id, true)
      setPriceTarget(null)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setPriceBusy(false)
    }
  }
  const delPrice = async (customerId: number, ruleId: number) => {
    try {
      await api.delete(`/pricing/${ruleId}`)
      message.success('已删除专属价')
      loadExpand(customerId, true)
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const columns: ColumnsType<Partner> = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (v, p) => (
        <div>
          <div style={{ fontWeight: 600 }}>{v}</div>
          {p.contactPerson && <div style={{ fontSize: 12, color: T.secondary }}>联系人 {p.contactPerson}</div>}
        </div>
      ),
    },
    { title: '电话', dataIndex: 'phone', width: 140, render: (v) => v || <span style={{ color: T.secondary }}>-</span> },
    { title: '地址', dataIndex: 'address', ellipsis: true, render: (v) => v || <span style={{ color: T.secondary }}>-</span> },
    {
      title: isCustomer ? '欠款' : '欠供应商',
      key: 'owed',
      width: 150,
      render: (_, p) =>
        (p.owed ?? 0) > 0 ? (
          <span>
            <b style={{ color: T.error }}>{fmtMoney(p.owed!)}</b>
            <Tag color="red" style={{ marginLeft: 6, borderRadius: 999 }}>
              {p.unpaidCount} 单
            </Tag>
          </span>
        ) : (
          <span style={{ color: T.emerald }}>已结清</span>
        ),
    },
    { title: '备注', dataIndex: 'notes', width: 140, ellipsis: true, render: (v) => v || <span style={{ color: T.secondary }}>-</span> },
    {
      title: '操作',
      key: 'ops',
      width: 120,
      fixed: 'right',
      render: (_, p) => (
        <span style={{ display: 'flex', gap: 2 }}>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(p)} />
          <Popconfirm title={`删除「${p.name}」？`} description="删除后历史单据不受影响" onConfirm={() => remove(p)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </span>
      ),
    },
  ]

  const renderExpand = (p: Partner) => {
    const c = expandCache[p.id]
    if (!c || c === 'loading') return <Skeleton active paragraph={{ rows: 2 }} />
    return (
      <div style={{ padding: '4px 8px 8px 48px', display: 'flex', gap: 40, flexWrap: 'wrap' }}>
        {c.unpaid.length > 0 && (
          <div style={{ minWidth: 240 }}>
            <Typography.Text strong style={{ fontSize: 13, color: T.error }}>
              未清单据（{c.unpaid.length}）
            </Typography.Text>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
              {c.unpaid.map((o) => (
                <li key={o.id}>
                  <span style={{ fontFamily: 'monospace' }}>{o.orderNo}</span> 应收 {fmtMoney(o.actualAmount)}·欠{' '}
                  <b style={{ color: T.error }}>{fmtMoney(o.unpaidAmount)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ minWidth: 260 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            近 90 天常买
          </Typography.Text>
          {c.frequent.length === 0 ? (
            <div style={{ color: T.secondary, fontSize: 12, marginTop: 4 }}>暂无成交记录</div>
          ) : (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
              {c.frequent.map((f) => (
                <li key={f.skuId}>
                  {f.productName}
                  {f.specText ? `（${f.specText}）` : ''} · 共 {fmtQty(f.totalQty)} · 上次 {fmtMoney(f.lastPrice)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              专属价
            </Typography.Text>
            <Button size="small" type="link" style={{ padding: 0, height: 'auto' }} onClick={() => openSetPrice(p)}>
              + 设专属价
            </Button>
          </div>
          {c.prices.length === 0 ? (
            <div style={{ color: T.secondary, fontSize: 12, marginTop: 4 }}>未设专属价（这个客户单独的价格）</div>
          ) : (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {c.prices.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <span>
                    {r.product?.name ?? '—'}
                    {r.sku?.specText ? `（${r.sku.specText}）` : ''} · <b>{fmtMoney(r.price)}</b>/{r.product?.unit ?? '件'}
                  </span>
                  <Popconfirm title="删除这条专属价？" onConfirm={() => delPrice(p.id, r.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} style={{ padding: '0 4px', height: 20 }} />
                  </Popconfirm>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, flex: 1 }}>
          {(['customer', 'supplier'] as Mode[]).map((m) => (
            <span
              key={m}
              onClick={() => {
                setMode(m)
                setKeyword('')
              }}
              style={{
                padding: '6px 16px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === m ? T.surfaceContainerLow : 'transparent',
                color: mode === m ? T.primary : T.secondary,
                border: mode === m ? `1px solid ${T.primary}33` : '1px solid transparent',
              }}
            >
              {m === 'customer' ? '客户' : '供应商'}
            </span>
          ))}
        </div>
        <Input
          key={mode}
          allowClear
          prefix={<SearchOutlined style={{ color: T.secondary }} />}
          placeholder={isCustomer ? '搜客户名 / 电话' : '搜供应商名 / 电话'}
          style={{ width: 220, borderRadius: 999 }}
          onChange={(e) => {
            const v = e.target.value.trim()
            window.clearTimeout((window as unknown as { __pk2?: number }).__pk2)
            ;(window as unknown as { __pk2?: number }).__pk2 = window.setTimeout(() => setKeyword(v), 400)
          }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建{isCustomer ? '客户' : '供应商'}
        </Button>
      </div>

      {owedCount > 0 && (
        <div
          style={{
            ...cardStyle,
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            borderColor: `${T.error}44`,
          }}
        >
          <Typography.Text>
            {isCustomer ? '共 ' : '欠 '}
            <b style={{ color: T.error }}>{owedCount}</b>
            {isCustomer ? ' 个客户欠款，合计 ' : ' 个供应商货款，合计 '}
            <b style={{ color: T.error }}>{fmtMoney(totalOwed)}</b>
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            按{isCustomer ? '欠款' : '应付'}从高到低排列；打对账单去「对账单」页
          </Typography.Text>
        </div>
      )}

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<Partner>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description={`还没有${isCustomer ? '客户' : '供应商'}`} /> }}
          expandable={
            isCustomer
              ? { expandedRowRender: renderExpand, onExpand: (open, p) => open && loadExpand(p.id) }
              : undefined
          }
          pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 个${isCustomer ? '客户' : '供应商'}` }}
          scroll={{ x: 720 }}
        />
      </div>

      <Modal
        title={`${editing ? '编辑' : '新建'}${isCustomer ? '客户' : '供应商'}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={submit}
        confirmLoading={busy}
        okText="保存"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '填名称' }]}>
            <Input placeholder={isCustomer ? '客户名 / 公司名' : '供应商名'} maxLength={40} />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="contactPerson" label="联系人">
              <Input maxLength={30} />
            </Form.Item>
            <Form.Item name="phone" label="电话">
              <Input maxLength={20} />
            </Form.Item>
          </div>
          <Form.Item name="address" label="地址">
            <Input maxLength={100} />
          </Form.Item>
          {isCustomer && (
            <Form.Item name="productTypeId" label="主营品类（选填）">
              <Select allowClear placeholder="不限" options={types.map((t) => ({ value: t.id, label: t.name }))} />
            </Form.Item>
          )}
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} maxLength={200} />
          </Form.Item>
          {editing && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              建于 {dayjs(editing.createdAt).format('YYYY-MM-DD')}
            </Typography.Text>
          )}
        </Form>
      </Modal>

      {/* 设专属价 */}
      <Modal
        title={priceTarget ? `给「${priceTarget.name}」设专属价` : ''}
        open={!!priceTarget}
        onCancel={() => setPriceTarget(null)}
        onOk={submitPrice}
        confirmLoading={priceBusy}
        okText="保存"
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          给这个客户的某个商品设单独的价格，开单卖给 TA 时自动用这个价（优先级：专属价 &gt; 上次成交价 &gt; 标价）。
        </Typography.Paragraph>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Select
            showSearch
            placeholder="选商品规格"
            value={priceSkuId}
            onChange={(v) => setPriceSkuId(v ?? null)}
            optionFilterProp="label"
            options={skuOpts.map((o) => ({ value: o.skuId, label: o.label }))}
          />
          <InputNumber
            style={{ width: '100%' }}
            prefix="¥"
            min={0}
            precision={2}
            placeholder="专属价"
            value={priceValue}
            onChange={(v) => setPriceValue(v)}
          />
        </div>
      </Modal>
    </div>
  )
}
