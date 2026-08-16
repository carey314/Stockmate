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
import { PrinterOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { fmtMoney, fmtQty, fmtTime } from '../lib/format'
import { t } from '../lib/i18n'
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
// 账户值是落库数据（后端 settlementAccount），只翻显示名，值本身不动
const ACCOUNT_EN: Record<string, string> = {
  现金: 'Cash',
  微信: 'WeChat Pay',
  支付宝: 'Alipay',
  银行卡: 'Bank card',
}
const accountLabel = (a: string) => t(a, ACCOUNT_EN[a] ?? a)
type Filter = 'all' | 'unpaid' | 'cancelled'

export default function OrdersPage() {
  const { message } = App.useApp()
  // 筛选进 URL（?status=unpaid&from=&to=）：刷新/分享"有欠款的单"这类视图不丢
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
  const [kw, setKw] = useState(() => urlParams.get('kw') ?? '') // 模糊查单号/客户
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
        ...(kw ? { keyword: kw } : {}),
      })
      setRows(data.list)
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

  // 深链 /orders?id=xx：收益日历等页跳过来直接打开该单详情（只清 id，保留筛选参数）
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
      message.success(t('已收款', 'Payment received'))
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
    if (items.length === 0) return message.warning(t('填要退的数量', 'Enter the quantity to return'))
    setRetBusy(true)
    try {
      await api.post(`/orders/${detail.id}/return`, { items, account: retAccount })
      message.success(t('已退货', 'Return completed'))
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
      message.success(t('订单已作废，库存已退回', 'Order voided, stock returned'))
      refreshAll(detail.id)
    } catch (e) {
      message.error((e as Error).message)
    }
  }
  const doPrint = () => window.print()

  const columns: ColumnsType<OrderRow> = [
    { title: t('单号', 'Order No.'), dataIndex: 'orderNo', render: (v) => <span style={{ fontFamily: 'monospace' }}>{v}</span> },
    { title: t('客户', 'Customer'), render: (_, o) => o.customer?.name ?? t('散客', 'Walk-in') },
    { title: t('应收', 'Due'), dataIndex: 'actualAmount', width: 100, render: (v) => fmtMoney(v) },
    {
      title: t('欠款', 'Outstanding'),
      dataIndex: 'unpaidAmount',
      width: 110,
      render: (v: number) => (v > 0 ? <b style={{ color: T.error }}>{fmtMoney(v)}</b> : <span style={{ color: T.emerald }}>{t('已结清', 'Settled')}</span>),
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
          {([['all', t('全部', 'All')], ['unpaid', t('有欠款', 'Outstanding')], ['cancelled', t('已作废', 'Voided')]] as [Filter, string][]).map(([k, label]) => (
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
          placeholder={t('搜单号 / 客户名', 'Search order no. / customer')}
          allowClear
          defaultValue={kw}
          onSearch={(v) => {
            setKw(v.trim())
            setPage(1)
          }}
          style={{ width: 210 }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {t(
            '开单在手机 App 更顺手（扫码/语音）；这里管理已开的单：收欠款、退货、作废',
            'Creating orders is easier in the mobile app (scan / voice); here you manage existing orders: collect payment, returns, void',
          )}
        </Typography.Text>
      </div>

      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<OrderRow>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description={t('没有订单', 'No orders')} /> }}
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

      {/* 详情抽屉 */}
      <Drawer
        open={!!detail || detailLoading}
        onClose={() => setDetail(null)}
        size="large"
        title={detail ? t(`订单 ${detail.orderNo}`, `Order ${detail.orderNo}`) : t('加载中', 'Loading')}
        className="print-area"
      >
        {detail && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <span>
                {t('客户：', 'Customer: ')}<b>{detail.customer?.name ?? t('散客', 'Walk-in')}</b>
              </span>
              <span style={{ color: T.secondary }}>
                {dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')} · {detail.operator?.realName ?? ''}
              </span>
            </div>
            {detail.status === 'cancelled' && <Tag style={{ marginBottom: 12 }}>{t('此单已作废', 'This order has been voided')}</Tag>}
            <Table<OrderItem>
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
                { title: t('单价', 'Unit price'), dataIndex: 'unitPrice', width: 72, render: (v) => fmtMoney(v) },
                { title: t('数量', 'Qty'), dataIndex: 'quantity', width: 56, render: (v) => fmtQty(v) },
                { title: t('小计', 'Subtotal'), dataIndex: 'subtotal', width: 80, render: (v) => fmtMoney(v) },
              ]}
            />
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <Row label={t('原价合计', 'Subtotal before discount')} value={fmtMoney(detail.totalAmount)} />
              {detail.discountAmount > 0 && <Row label={t('折扣', 'Discount')} value={`- ${fmtMoney(detail.discountAmount)}`} />}
              <Row label={t('应收', 'Due')} value={fmtMoney(detail.actualAmount)} bold />
              <Row label={t('已收', 'Received')} value={fmtMoney(detail.paidAmount)} />
              {detail.unpaidAmount > 0 && <Row label={t('欠款', 'Outstanding')} value={fmtMoney(detail.unpaidAmount)} danger bold />}
              {detail.settlementAccount && <Row label={t('结算', 'Settlement account')} value={accountLabel(detail.settlementAccount)} />}
            </div>

            {detail.status === 'completed' && (
              <div className="no-print" style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {detail.unpaidAmount > 0 && (
                  <Button type="primary" onClick={() => { payForm.setFieldsValue({ amount: detail.unpaidAmount, account: '现金' }); setPayOpen(true) }}>
                    {t('收欠款', 'Collect payment')}
                  </Button>
                )}
                {canReturn && (
                  <Button onClick={() => { setRetQty({}); setRetOpen(true) }}>{t('退货', 'Return')}</Button>
                )}
                <Button icon={<PrinterOutlined />} onClick={doPrint}>
                  {t('打印', 'Print')}
                </Button>
                <Popconfirm
                  title={t('作废这单？库存会退回、应收一并冲销', 'Void this order? Stock will be returned and the receivable written off')}
                  onConfirm={doCancel}
                >
                  <Button danger>{t('作废', 'Void')}</Button>
                </Popconfirm>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* 收款 Modal */}
      <Modal
        title={t('收欠款', 'Collect payment')}
        open={payOpen}
        onCancel={() => setPayOpen(false)}
        onOk={doReceive}
        confirmLoading={payBusy}
        okText={t('确认收款', 'Confirm payment')}
      >
        <Form form={payForm} layout="vertical">
          <Form.Item name="amount" label={t('收款金额', 'Amount received')} rules={[{ required: true, message: t('填金额', 'Enter an amount') }]}>
            <InputNumber style={{ width: '100%' }} prefix="¥" min={0.01} precision={2} max={detail?.unpaidAmount} />
          </Form.Item>
          <Form.Item name="account" label={t('收款方式', 'Payment method')}>
            <Select options={ACCOUNTS.map((a) => ({ value: a, label: accountLabel(a) }))} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              `当前欠款 ${detail ? fmtMoney(detail.unpaidAmount) : ''}，可分次收`,
              `Outstanding ${detail ? fmtMoney(detail.unpaidAmount) : ''} — can be collected in instalments`,
            )}
          </Typography.Text>
        </Form>
      </Modal>

      {/* 退货 Modal */}
      <Modal
        title={t('销售退货', 'Sales return')}
        open={retOpen}
        onCancel={() => setRetOpen(false)}
        onOk={doReturn}
        confirmLoading={retBusy}
        okText={t('确认退货', 'Confirm return')}
        width={520}
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t(
            '填每个商品要退的数量（不超过可退数）。退货会退回库存、冲减应收/退现。',
            'Enter the quantity to return for each product (no more than the returnable amount). Returns add stock back and offset the receivable or refund cash.',
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
          {t('退款方式：', 'Refund method: ')}
          <Select size="small" value={retAccount} onChange={setRetAccount} options={ACCOUNTS.map((a) => ({ value: a, label: accountLabel(a) }))} style={{ width: 120, marginLeft: 8 }} />
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
