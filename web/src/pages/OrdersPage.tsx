import {
  App,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PrinterOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { fmtMoney, fmtQty, fmtTime } from '../lib/format'
import { T, cardStyle } from '../theme'

interface OrderItem {
  id: number
  productName: string
  specText: string | null
  quantity: number
  returnedQty: number
  unitPrice: number
  subtotal: number
}
interface OrderRow {
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
  printedAt: string | null
  createdAt: string
  customer: { id: number; name: string } | null
  _count?: { items: number }
}
interface OrderDetail extends OrderRow {
  items: OrderItem[]
  operator: { realName: string } | null
}

const ACCOUNTS = ['现金', '微信', '支付宝', '银行卡']
type Filter = 'all' | 'unpaid' | 'cancelled'

export default function OrdersPage() {
  const { message } = App.useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ list: OrderRow[]; pagination: { total: number } }>('/orders', {
        page,
        pageSize,
        ...(filter === 'unpaid' ? { unpaidOnly: 1 } : {}),
        ...(filter === 'cancelled' ? { status: 'cancelled' } : {}),
        ...(range ? { startDate: range[0].format('YYYY-MM-DD'), endDate: range[1].format('YYYY-MM-DD') } : {}),
      })
      setRows(data.list)
      setTotal(data.pagination.total)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filter, range, message])
  useEffect(() => {
    load()
  }, [load])

  // ===== 详情抽屉 =====
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const openDetail = async (id: number) => {
    setDetailLoading(true)
    setDetail(null)
    try {
      setDetail(await api.get<OrderDetail>(`/orders/${id}`))
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

  // ===== 收款 =====
  const [payOpen, setPayOpen] = useState(false)
  const [payForm] = Form.useForm()
  const [payBusy, setPayBusy] = useState(false)
  const doReceive = async () => {
    if (!detail) return
    const v = await payForm.validateFields()
    setPayBusy(true)
    try {
      await api.post(`/orders/${detail.id}/receive-payment`, { amount: v.amount, settlementAccount: v.account })
      message.success('已收款')
      setPayOpen(false)
      payForm.resetFields()
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setPayBusy(false)
    }
  }

  // ===== 退货 =====
  const [retOpen, setRetOpen] = useState(false)
  const [retQty, setRetQty] = useState<Record<number, number>>({})
  const [retAccount, setRetAccount] = useState<string>('现金')
  const [retBusy, setRetBusy] = useState(false)
  const doReturn = async () => {
    if (!detail) return
    const items = Object.entries(retQty)
      .filter(([, q]) => q > 0)
      .map(([itemId, quantity]) => ({ itemId: Number(itemId), quantity }))
    if (items.length === 0) return message.warning('填要退的数量')
    setRetBusy(true)
    try {
      await api.post(`/orders/${detail.id}/return`, { items, account: retAccount })
      message.success('已退货')
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
      await api.put(`/orders/${detail.id}/cancel`)
      message.success('订单已作废，库存已退回')
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    }
  }
  const doPrint = () => window.print()

  const columns: ColumnsType<OrderRow> = [
    { title: '单号', dataIndex: 'orderNo', render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: '客户', render: (_, o) => o.customer?.name ?? '散客' },
    { title: '应收', dataIndex: 'actualAmount', width: 100, render: (v) => fmtMoney(v) },
    {
      title: '欠款',
      dataIndex: 'unpaidAmount',
      width: 110,
      render: (v: number) => (v > 0 ? <b style={{ color: T.error }}>{fmtMoney(v)}</b> : <span style={{ color: T.emerald }}>已结清</span>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (s) => (s === 'cancelled' ? <Tag>已作废</Tag> : <Tag color="green">已完成</Tag>),
    },
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
          {([['all', '全部'], ['unpaid', '有欠款'], ['cancelled', '已作废']] as [Filter, string][]).map(([k, label]) => (
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
        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
          开单在手机 App 更顺手（扫码/语音）；这里管理已开的单：收欠款、退货、作废
        </Typography.Text>
      </div>

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<OrderRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description="没有订单" /> }}
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

      {/* 详情抽屉 */}
      <Drawer
        open={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        size="large"
        title={detail ? `订单 ${detail.orderNo}` : '加载中'}
        className="print-area"
      >
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span>
                客户：<b>{detail.customer?.name ?? '散客'}</b>
              </span>
              <span style={{ color: T.secondary }}>
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')} · {detail.operator?.realName ?? ''}
              </span>
            </div>
            {detail.status === 'cancelled' && <Tag style={{ marginBottom: 12 }}>此单已作废</Tag>}
            <Table<OrderItem>
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
                { title: '单价', dataIndex: 'unitPrice', width: 72, render: (v) => fmtMoney(v) },
                { title: '数量', dataIndex: 'quantity', width: 56, render: (v) => fmtQty(v) },
                { title: '小计', dataIndex: 'subtotal', width: 80, render: (v) => fmtMoney(v) },
              ]}
            />
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <Row label="原价合计" value={fmtMoney(detail.totalAmount)} />
              {detail.discountAmount > 0 && <Row label="折扣" value={`- ${fmtMoney(detail.discountAmount)}`} />}
              <Row label="应收" value={fmtMoney(detail.actualAmount)} bold />
              <Row label="已收" value={fmtMoney(detail.paidAmount)} />
              {detail.unpaidAmount > 0 && <Row label="欠款" value={fmtMoney(detail.unpaidAmount)} danger bold />}
              {detail.settlementAccount && <Row label="结算" value={detail.settlementAccount} />}
            </div>

            {detail.status === 'completed' && (
              <div className="no-print" style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail.unpaidAmount > 0 && (
                  <Button type="primary" onClick={() => { payForm.setFieldsValue({ amount: detail.unpaidAmount, account: '现金' }); setPayOpen(true) }}>
                    收欠款
                  </Button>
                )}
                {canReturn && (
                  <Button onClick={() => { setRetQty({}); setRetOpen(true) }}>退货</Button>
                )}
                <Button icon={<PrinterOutlined />} onClick={doPrint}>
                  打印
                </Button>
                <Popconfirm title="作废这单？库存会退回、应收一并冲销" onConfirm={doCancel}>
                  <Button danger>作废</Button>
                </Popconfirm>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 收款 Modal */}
      <Modal title="收欠款" open={payOpen} onCancel={() => setPayOpen(false)} onOk={doReceive} confirmLoading={payBusy} okText="确认收款">
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label="收款金额" rules={[{ required: true, message: '填金额' }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" min={0.01} precision={2} max={detail?.unpaidAmount} />
          </Form.Item>
          <Form.Item name="account" label="收款方式">
            <Select options={ACCOUNTS.map((a) => ({ value: a, label: a }))} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前欠款 {detail ? fmtMoney(detail.unpaidAmount) : ''}，可分次收
          </Typography.Text>
        </Form>
      </Modal>

      {/* 退货 Modal */}
      <Modal title="销售退货" open={retOpen} onCancel={() => setRetOpen(false)} onOk={doReturn} confirmLoading={retBusy} okText="确认退货" width={520}>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          填每个商品要退的数量（不超过可退数）。退货会退回库存、冲减应收/退现。
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
              <InputNumber
                size="small"
                min={0}
                max={returnable}
                disabled={returnable <= 0}
                value={retQty[it.id] ?? 0}
                onChange={(v) => setRetQty((p) => ({ ...p, [it.id]: v ?? 0 }))}
                style={{ width: 90 }}
              />
            </div>
          )
        })}
        <div style={{ marginTop: 12 }}>
          退款方式：
          <Select size="small" value={retAccount} onChange={setRetAccount} options={ACCOUNTS.map((a) => ({ value: a, label: a }))} style={{ width: 120, marginLeft: 8 }} />
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value, bold, danger }: { label: string; value: string; bold?: boolean; danger?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: T.secondary }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 400, color: danger ? T.error : T.onSurface }}>{value}</span>
    </div>
  )
}
