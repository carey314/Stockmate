import { Alert, App, Button, Checkbox, Empty, Input, Select, Table, Tag, Typography } from 'antd'
import { CheckCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../auth'
import { fmtMoney, fmtQty } from '../lib/format'
import { T, cardStyle } from '../theme'

// ===== parseEntry 返回结构 =====
interface SaleDraft {
  name: string
  quantity: number
  unit: string
  totalAmount: number | null
  unitPrice: number | null
  paid: boolean | null
  suggestedSkuId: number | null
  customer: { id: number; name: string } | null
  matchedProduct: { id: number; name: string; unit: string } | null
}
interface PurchaseDraft {
  name: string
  quantity: number
  unit: string
  totalCost: number | null
  unitCost: number | null
  matchedProduct: { id: number; name: string; unit: string } | null
  suggestedType: { id: number; name: string } | null
}
interface ExpenseDraft {
  category: string
  amount: number
  note: string | null
}
interface AggDraft {
  label: string
  amount: number
  note: string | null
}
interface ParseResp {
  purchases: PurchaseDraft[]
  sales: SaleDraft[]
  expenses: ExpenseDraft[]
  aggregates: AggDraft[]
  warnings: string[]
  todayContext: { ordersCount: number; ordersTotal: number; incomesTotal: number } | null
}
interface ConfirmResp {
  [k: string]: unknown
}

const MODES = [
  { value: 'default', label: '随手记（进/销/支混着说）' },
  { value: 'customerOrder', label: '客户订货消息（全按卖出）' },
  { value: 'purchaseBill', label: '供应商送货单（全按进货）' },
]

const PLACEHOLDER = `把要记的事粘贴/打进来，AI 帮你分成进货、销售、支出。例如：
老王拿了2件泸州老窖，收了微信
进了30斤面粉花了90块
摊位费50

或者直接粘贴客户发来的订货消息、供应商送货单文字（上面选对应模式）。
AI 只出草案，你确认后才落库；退货/换货它不碰（要去订单里退）。`

export default function QuickEntryPage() {
  const { message } = App.useApp()
  const [text, setText] = useState('')
  const [mode, setMode] = useState('default')
  const [parsing, setParsing] = useState(false)
  const [resp, setResp] = useState<ParseResp | null>(null)
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState<ConfirmResp | null>(null)

  // 口述文本/解析草案未确认入库时，拦误刷新误关标签（done 后草案已落库，不拦）
  useEffect(() => {
    const dirty = !done && (text.trim().length > 0 || resp !== null)
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [text, resp, done])

  // 可编辑草案的本地态：用索引 key 存 勾选/单价/收款/进价 覆盖
  const [saleEdit, setSaleEdit] = useState<Record<number, { on: boolean; unitPrice: number | null; paid: boolean | null }>>({})
  const [purEdit, setPurEdit] = useState<Record<number, { on: boolean; unitCost: number | null }>>({})
  const [expOn, setExpOn] = useState<Record<number, boolean>>({})
  const [aggOn, setAggOn] = useState<Record<number, boolean>>({})
  // 没档案的商品「顺便建档」勾选（键 s0/p1…）——建档后销售真扣库存、进货真入库
  const [buildFile, setBuildFile] = useState<Record<string, boolean>>({})

  // 建档要归到哪个品类：主营品类优先，没有就第一个品类；一个品类都没有则禁用建档
  const { profile } = useAuth()
  const [types, setTypes] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    api
      .get<{ id: number; name: string }[] | { list: { id: number; name: string }[] }>('/product-types')
      .then((d) => setTypes(Array.isArray(d) ? d : d.list))
      .catch(() => {})
  }, [])
  const createTypeId = profile?.mainTypeId ?? types[0]?.id ?? null
  const createTypeName = types.find((x) => x.id === createTypeId)?.name

  const parse = async () => {
    if (text.trim().length < 2) return message.warning('先写点内容')
    setParsing(true)
    setResp(null)
    setDone(null)
    try {
      const r = await api.post<ParseResp>('/ai/parse-entry', { text, mode })
      setResp(r)
      // 默认全选，单价/收款/进价用 AI 给的初值
      setSaleEdit(Object.fromEntries(r.sales.map((s, i) => [i, { on: true, unitPrice: s.unitPrice, paid: s.paid }])))
      setPurEdit(Object.fromEntries(r.purchases.map((p, i) => [i, { on: true, unitCost: p.unitCost }])))
      setExpOn(Object.fromEntries(r.expenses.map((_, i) => [i, true])))
      setAggOn(Object.fromEntries(r.aggregates.map((_, i) => [i, true])))
      const nItems = r.sales.length + r.purchases.length + r.expenses.length + r.aggregates.length
      if (nItems === 0) message.warning('AI 没解析出可入账的内容，看看下面的提示')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  const commit = async () => {
    if (!resp) return
    // 按索引组装（filter 会丢索引，先配对再过滤）；
    // 「顺便建档」由 confirm-entry 后端处理（createProduct，与进货同构、绕过品类必填字段）
    const salesBody = resp.sales
      .map((s, i) => ({ s, e: saleEdit[i], i }))
      .filter((x) => x.e?.on)
      .map(({ s, e, i }) => ({
        skuId: s.suggestedSkuId ?? null,
        createProduct: !s.matchedProduct && !!buildFile[`s${i}`] && !!createTypeId,
        productTypeId: !s.matchedProduct && buildFile[`s${i}`] ? createTypeId : null,
        customerId: s.customer?.id ?? null,
        paid: e.paid,
        name: s.name,
        quantity: s.quantity,
        unit: s.unit || (s.matchedProduct?.unit ?? '件'),
        totalAmount: s.totalAmount,
        unitPrice: e.unitPrice,
      }))
    const purchasesBody = resp.purchases
      .map((p, i) => ({ p, e: purEdit[i], i }))
      .filter((x) => x.e?.on)
      .map(({ p, e, i }) => ({
        productId: p.matchedProduct?.id ?? null,
        // 勾了「顺便建档」→ 后端建商品并按这单入库（confirm-entry 原生支持）
        createProduct: !p.matchedProduct && !!buildFile[`p${i}`] && !!createTypeId,
        productTypeId: !p.matchedProduct && buildFile[`p${i}`] ? createTypeId : null,
        name: p.name,
        quantity: p.quantity,
        unit: p.unit || '件',
        totalCost: p.totalCost,
        unitCost: e.unitCost,
      }))
    const expensesBody = resp.expenses.filter((_, i) => expOn[i]).map((x) => ({ category: x.category, amount: x.amount, note: x.note }))
    const aggregatesBody = resp.aggregates.filter((_, i) => aggOn[i]).map((x) => ({ label: x.label, amount: x.amount, note: x.note }))
    if (salesBody.length + purchasesBody.length + expensesBody.length + aggregatesBody.length === 0)
      return message.warning('没有勾选任何一条')
    setCommitting(true)
    try {
      const r = await api.post<ConfirmResp>('/ai/confirm-entry', {
        purchases: purchasesBody,
        sales: salesBody,
        expenses: expensesBody,
        aggregates: aggregatesBody,
      })
      setDone(r)
      message.success('已入账')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCommitting(false)
    }
  }

  const totalItems = useMemo(
    () => (resp ? resp.sales.length + resp.purchases.length + resp.expenses.length + resp.aggregates.length : 0),
    [resp],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
      <div style={{ ...cardStyle, padding: 20 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={mode} onChange={setMode} options={MODES} style={{ width: 280 }} />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={parsing} onClick={parse}>
            {parsing ? 'AI 解析中…' : 'AI 解析'}
          </Button>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            只出草案，确认才落库；AI 绝不编成本价，退货不碰
          </Typography.Text>
        </div>
        <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} autoSize={{ minRows: 5, maxRows: 12 }} style={{ fontSize: 14 }} />
      </div>

      {resp && !done && (
        <div style={{ ...cardStyle, padding: 20 }}>
          {resp.warnings.length > 0 && (
            <Alert
              style={{ marginBottom: 14 }}
              type="warning"
              showIcon
              message="AI 的提示（请人工处理）"
              description={<ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{resp.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            />
          )}

          {resp.sales.length > 0 && (
            <Section title={`销售 ${resp.sales.length} 笔`}>
              <Table<SaleDraft>
                rowKey={(_, i) => `s${i}`}
                size="small"
                pagination={false}
                dataSource={resp.sales}
                columns={[
                  {
                    title: '入账',
                    width: 50,
                    render: (_, __, i) => <Checkbox checked={saleEdit[i]?.on} onChange={(e) => setSaleEdit((p) => ({ ...p, [i]: { ...p[i], on: e.target.checked } }))} />,
                  },
                  {
                    title: '商品',
                    render: (_, s, i) => (
                      <span>
                        {s.name} <span style={{ color: T.secondary }}>×{fmtQty(s.quantity)}{s.unit}</span>
                        {s.matchedProduct ? (
                          <Tag color="green" style={{ marginLeft: 6 }}>已认出</Tag>
                        ) : (
                          <>
                            <Tag color="orange" style={{ marginLeft: 6 }}>没档案·只记收入</Tag>
                            <Checkbox
                              checked={!!buildFile[`s${i}`]}
                              disabled={!createTypeId}
                              onChange={(e) => setBuildFile((p) => ({ ...p, [`s${i}`]: e.target.checked }))}
                              style={{ marginLeft: 4, fontSize: 12 }}
                            >
                              <span style={{ fontSize: 12 }}>
                                {createTypeId ? `顺便建档到「${createTypeName}」并扣库存` : '先建品类才能建档'}
                              </span>
                            </Checkbox>
                          </>
                        )}
                      </span>
                    ),
                  },
                  { title: '客户', width: 90, render: (_, s) => s.customer?.name ?? '散客' },
                  {
                    title: '单价',
                    width: 110,
                    render: (_, __, i) => (
                      <Input
                        size="small"
                        prefix="¥"
                        value={saleEdit[i]?.unitPrice ?? ''}
                        placeholder="按标价"
                        onChange={(e) => { const v = e.target.value.trim(); setSaleEdit((p) => ({ ...p, [i]: { ...p[i], unitPrice: v === '' ? null : Number(v) } })) }}
                        style={{ width: 90 }}
                      />
                    ),
                  },
                  {
                    title: '收款',
                    width: 132,
                    render: (_, s, i) => (
                      <Select
                        size="small"
                        value={saleEdit[i]?.paid === true ? 'paid' : saleEdit[i]?.paid === false ? 'credit' : 'unknown'}
                        onChange={(v) => setSaleEdit((p) => ({ ...p, [i]: { ...p[i], paid: v === 'paid' ? true : v === 'credit' ? false : null } }))}
                        options={[
                          { value: 'paid', label: '已收' },
                          { value: 'credit', label: '挂账' },
                          // "没提"=口述里没说收没收钱。落账默认：散客当场结清、记名客户挂账——把结果直接写在脸上。
                          // 注意 AI 会把口述里的"散客"二字匹配到内置散客档案，它不算记名客户
                          { value: 'unknown', label: s.customer && s.customer.name !== '散客' ? '没提·按挂账' : '没提·按已收' },
                        ]}
                        style={{ width: 120 }}
                      />
                    ),
                  },
                ]}
              />
            </Section>
          )}

          {resp.purchases.length > 0 && (
            <Section title={`进货 ${resp.purchases.length} 笔`}>
              <Table<PurchaseDraft>
                rowKey={(_, i) => `p${i}`}
                size="small"
                pagination={false}
                dataSource={resp.purchases}
                columns={[
                  { title: '入账', width: 50, render: (_, __, i) => <Checkbox checked={purEdit[i]?.on} onChange={(e) => setPurEdit((p) => ({ ...p, [i]: { ...p[i], on: e.target.checked } }))} /> },
                  {
                    title: '商品',
                    render: (_, p, i) => (
                      <span>
                        {p.name} <span style={{ color: T.secondary }}>×{fmtQty(p.quantity)}{p.unit}</span>
                        {p.matchedProduct ? (
                          <Tag color="green" style={{ marginLeft: 6 }}>已认出</Tag>
                        ) : (
                          <>
                            <Tag color="orange" style={{ marginLeft: 6 }}>没档案·只记花销</Tag>
                            <Checkbox
                              checked={!!buildFile[`p${i}`]}
                              disabled={!createTypeId}
                              onChange={(e) => setBuildFile((prev) => ({ ...prev, [`p${i}`]: e.target.checked }))}
                              style={{ marginLeft: 4 }}
                            >
                              <span style={{ fontSize: 12 }}>
                                {createTypeId ? `顺便建档到「${createTypeName}」并入库` : '先建品类才能建档'}
                              </span>
                            </Checkbox>
                          </>
                        )}
                      </span>
                    ),
                  },
                  {
                    title: '进价',
                    width: 110,
                    render: (_, __, i) => (
                      <Input
                        size="small"
                        prefix="¥"
                        value={purEdit[i]?.unitCost ?? ''}
                        placeholder="单价"
                        onChange={(e) => { const v = e.target.value.trim(); setPurEdit((p) => ({ ...p, [i]: { ...p[i], unitCost: v === '' ? null : Number(v) } })) }}
                        style={{ width: 90 }}
                      />
                    ),
                  },
                  { title: '总花费', width: 90, render: (_, p) => (p.totalCost != null ? fmtMoney(p.totalCost) : '-') },
                ]}
              />
            </Section>
          )}

          {resp.expenses.length > 0 && (
            <Section title={`支出 ${resp.expenses.length} 笔`}>
              {resp.expenses.map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 13 }}>
                  <Checkbox checked={expOn[i]} onChange={(e) => setExpOn((p) => ({ ...p, [i]: e.target.checked }))} />
                  <Tag>{x.category}</Tag>
                  <b>{fmtMoney(x.amount)}</b>
                  {x.note && <span style={{ color: T.secondary }}>{x.note}</span>}
                </div>
              ))}
            </Section>
          )}

          {resp.aggregates.length > 0 && (
            <Section title={`营业额汇总 ${resp.aggregates.length} 笔`}>
              {resp.todayContext && resp.todayContext.ordersTotal + resp.todayContext.incomesTotal > 0 && (
                <Alert type="info" showIcon style={{ marginBottom: 8 }} message={`今天已记 ${resp.todayContext.ordersCount} 张订单 ¥${resp.todayContext.ordersTotal}${resp.todayContext.incomesTotal ? ` + 其他收入 ¥${resp.todayContext.incomesTotal}` : ''}——这笔汇总别和它们重复入账`} />
              )}
              {resp.aggregates.map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 13 }}>
                  <Checkbox checked={aggOn[i]} onChange={(e) => setAggOn((p) => ({ ...p, [i]: e.target.checked }))} />
                  <span>{x.label}</span>
                  <b>{fmtMoney(x.amount)}</b>
                  {x.note && <span style={{ color: T.secondary }}>{x.note}</span>}
                </div>
              ))}
            </Section>
          )}

          {totalItems === 0 && resp.warnings.length === 0 && <Empty description="没解析出可入账的内容" />}

          {totalItems > 0 && (
            <Button type="primary" icon={<CheckCircleOutlined />} loading={committing} onClick={commit} style={{ marginTop: 10 }}>
              确认入账勾选的项
            </Button>
          )}
        </div>
      )}

      {done && (
        <div style={{ ...cardStyle, padding: 20 }}>
          <Typography.Text strong style={{ fontSize: 16, color: T.emerald }}>
            ✓ 已入账
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
            销售落成订单、进货落成进货单/花销、支出和营业额进流水。去对应页面可查。
          </Typography.Paragraph>
          <Button style={{ marginTop: 12 }} onClick={() => { setResp(null); setDone(null); setText('') }}>
            再记一笔
          </Button>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Typography.Text strong style={{ fontSize: 14, display: 'block', marginBottom: 8 }}>
        {title}
      </Typography.Text>
      {children}
    </div>
  )
}
