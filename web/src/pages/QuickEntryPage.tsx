import { Alert, App, Button, Checkbox, Empty, Input, Select, Table, Tag, Tooltip, Typography } from 'antd'
import { CheckCircleOutlined, QuestionCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../api/client'
import { fetchAllPages } from '../api/pagination'
import { sessionSnapshot, isCurrentSession } from '../lib/session'
import { draftStorage } from '../lib/draftStorage'
import { useAuth } from '../auth'
import { AiQuotaTag, handleAiQuotaError } from '../components/AiQuota'
import { refreshEntitlement } from '../hooks/useEntitlement'
import { fmtMoney, fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { T, cardStyle } from '../theme'

const ACCOUNTS = ['现金', '微信', '支付宝', '银行卡']
const money = (value: number) => Math.round(value * 100) / 100
const amount = (quantity: number, price: number | null, total: number | null) => price == null ? total : money(quantity * price)
interface MatchedProduct {
  id: number
  name: string
  unit: string
  skus?: { id: number; specText: string; price?: number }[]
}
// ===== parseEntry 返回结构 =====
interface SaleDraft {
  name: string
  quantity: number
  unit: string
  totalAmount: number | null
  unitPrice: number | null
  paid: boolean | null
  suggestedSkuId: number | null
  settlementAccount?: string
  customer: { id: number; name: string } | null
  matchedProduct: MatchedProduct | null
}
interface PurchaseDraft {
  suggestedSkuId?: number | null
  supplier?: { id: number; name: string } | null
  paidAmount?: number | null
  settlementAccount?: string
  name: string
  quantity: number
  unit: string
  totalCost: number | null
  unitCost: number | null
  matchedProduct: MatchedProduct | null
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
  requestId?: string
  replayed?: boolean
  orders?: { id: number; orderNo: string; actualAmount: number; paidAmount: number; unpaidAmount: number }[]
  purchaseOrders?: { id: number; orderNo: string; actualAmount: number; paidAmount: number; unpaidAmount: number }[]
  incomes?: { id: number; source: string; amount: number; note?: string | null }[]
  expenses?: { id: number; category: string; amount: number; note?: string | null }[]
  negativeStock?: unknown[]
}

type SaleEdits = Record<number, { on: boolean; unitPrice: number | null; paid: boolean | null; skuId: number | null; account: string }>
type PurchaseEdits = Record<number, { on: boolean; unitCost: number | null; skuId: number | null; supplierId: number | null; paidAmount: number | null; account: string }>
interface SavedDraft {
  text: string; mode: string; resp: ParseResp | null; done: ConfirmResp | null
  pending: Record<string, unknown> | null
  saleEdit: SaleEdits; purEdit: PurchaseEdits; expOn: Record<number, boolean>; aggOn: Record<number, boolean>; buildFile: Record<string, boolean>
}

const MODES = [
  { value: 'default', label: t('随手记（进/销/支混着说）', 'Mixed notes (purchases / sales / expenses)') },
  { value: 'customerOrder', label: t('客户订货消息（全按卖出）', 'Customer order message (all as sales)') },
  { value: 'purchaseBill', label: t('供应商送货单（全按进货）', 'Supplier delivery note (all as purchases)') },
]

const PLACEHOLDER = t(
  `把要记的事粘贴/打进来，AI 帮你分成进货、销售、支出。例如：
老王拿了2件泸州老窖，收了微信
进了30斤面粉花了90块
摊位费50

或者直接粘贴客户发来的订货消息、供应商送货单文字（上面选对应模式）。
AI 只出草案，你确认后才落库；退货/换货它不碰（要去订单里退）。`,
  `Paste or type whatever you need to record and AI will split it into purchases, sales and expenses. For example:
Old Wang took 2 cases of Luzhou Laojiao, paid by WeChat
Bought 30 jin of flour for 90 yuan
Stall fee 50

Or just paste a customer's order message or the text of a supplier delivery note (pick the matching mode above).
AI only drafts entries — nothing is saved until you confirm. It never touches returns or exchanges (handle those in Orders).`,
)

export default function QuickEntryPage() {
  const { message, modal } = App.useApp()
  const { user, profile } = useAuth()
  const [storage] = useState(() => draftStorage<SavedDraft>('quick-entry', user?.id, profile?.storeId))
  const saved = storage.initial
  const [storageError, setStorageError] = useState(storage.readError)
  const [text, setText] = useState(saved?.text ?? '')
  const [mode, setMode] = useState(saved?.mode ?? 'default')
  const [parsing, setParsing] = useState(false)
  const [resp, setResp] = useState<ParseResp | null>(saved?.resp ?? null)
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState<ConfirmResp | null>(saved?.done ?? null)
  const [frozen, setFrozen] = useState(!!saved?.pending && !saved.done)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const pending = useRef<Record<string, unknown> | null>(saved?.pending ?? null)
  const inFlight = useRef(false)
  const version = useRef(0)
  useEffect(() => () => { version.current++ }, [])

  // 口述文本/解析草案未确认入库时，拦误刷新误关标签（done 后草案已落库，不拦）
  useEffect(() => {
    const dirty = !done && (text.trim().length > 0 || resp !== null)
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [text, resp, done])

  // 可编辑草案的本地态：用索引 key 存 勾选/单价/收款/进价 覆盖
  const [saleEdit, setSaleEdit] = useState<SaleEdits>(saved?.saleEdit ?? {})
  const [purEdit, setPurEdit] = useState<PurchaseEdits>(saved?.purEdit ?? {})
  const [expOn, setExpOn] = useState<Record<number, boolean>>(saved?.expOn ?? {})
  const [aggOn, setAggOn] = useState<Record<number, boolean>>(saved?.aggOn ?? {})
  // 没档案的商品「顺便建档」勾选（键 s0/p1…）——建档后销售真扣库存、进货真入库
  const [buildFile, setBuildFile] = useState<Record<string, boolean>>(saved?.buildFile ?? {})

  // 建档要归到哪个品类：主营品类优先，没有就第一个品类；一个品类都没有则禁用建档
  const snapshot = (): SavedDraft => ({ text, mode, resp, done, pending: pending.current, saleEdit, purEdit, expOn, aggOn, buildFile })
  useEffect(() => {
    if (!storage.current()) return
    setStorageError(storage.write({ text, mode, resp, done, pending: pending.current, saleEdit, purEdit, expOn, aggOn, buildFile }))
  }, [storage, text, mode, resp, done, saleEdit, purEdit, expOn, aggOn, buildFile, frozen])
  const isAdmin = user?.role === 'admin'
  const [types, setTypes] = useState<{ id: number; name: string }[]>([])
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([])
  const [lookupError, setLookupError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([
      api.get<{ id: number; name: string }[] | { list: { id: number; name: string }[] }>('/product-types'),
      fetchAllPages<{ id: number; name: string }>('/suppliers'),
    ]).then(([categories, parties]) => {
      if (!alive) return
      setTypes(Array.isArray(categories) ? categories : categories.list)
      setSuppliers(parties)
    }).catch((e) => { if (alive) setLookupError((e as Error).message) })
    return () => { alive = false }
  }, [])
  const createTypeId = profile?.mainTypeId ?? types[0]?.id ?? null
  const createTypeName = types.find((x) => x.id === createTypeId)?.name

  const parse = async () => {
    if (!storage.current() || storage.readError || inFlight.current || frozen || parsing) return
    if (text.trim().length < 2) return message.warning(t('先写点内容', 'Type something first'))
    const identity = sessionSnapshot()
    const ticket = ++version.current
    const current = () => ticket === version.current && isCurrentSession(identity)
    setParsing(true)
    try {
      const r = await api.post<ParseResp>('/ai/parse-entry', { text, mode })
      if (!current()) return
      setBuildFile({})
      pending.current = null
      setConfirmError(null)
      setDone(null)
      setResp(r)
      // 默认全选，单价/收款/进价用 AI 给的初值
      setSaleEdit(Object.fromEntries(r.sales.map((s, i) => [i, { on: true, unitPrice: s.unitPrice, paid: s.paid, skuId: s.suggestedSkuId ?? (s.matchedProduct?.skus?.length === 1 ? s.matchedProduct.skus[0].id : null), account: s.settlementAccount && ACCOUNTS.includes(s.settlementAccount) ? s.settlementAccount : '现金' }])))
      setPurEdit(Object.fromEntries(r.purchases.map((p, i) => [i, { on: true, unitCost: p.unitCost, skuId: p.suggestedSkuId ?? (p.matchedProduct?.skus?.length === 1 ? p.matchedProduct.skus[0].id : null), supplierId: p.supplier?.id ?? null, paidAmount: p.settlementAccount === '挂账' ? 0 : (p.paidAmount ?? null), account: p.settlementAccount ?? '现金' }])))
      setExpOn(Object.fromEntries(r.expenses.map((_, i) => [i, true])))
      setAggOn(Object.fromEntries(r.aggregates.map((_, i) => [i, true])))
      refreshEntitlement()
      const nItems = r.sales.length + r.purchases.length + r.expenses.length + r.aggregates.length
      if (nItems === 0)
        message.warning(
          t('AI 没解析出可入账的内容，看看下面的提示', 'AI found nothing to record — see the notes below'),
        )
    } catch (e) {
      if (!current()) return
      if (!handleAiQuotaError(e, modal, isAdmin)) message.error((e as Error).message)
    } finally {
      if (current()) setParsing(false)
    }
  }

  const commit = async () => {
    if (!storage.current() || storage.readError || !resp || inFlight.current || done) return
    // 未知结果只能重试完全相同的内容/ID，不能因编辑而创建另一张真实单据。
    let body = pending.current
    if (!body) {
      const salesBody = resp.sales.flatMap((s, i) => {
        const e = saleEdit[i]
        if (!e?.on) return []
        const paid = e.paid ?? !(s.customer && s.customer.name !== '散客')
        return [{
          skuId: e.skuId,
          createProduct: !s.matchedProduct && !!buildFile[`s${i}`] && !!createTypeId,
          productTypeId: !s.matchedProduct && buildFile[`s${i}`] ? createTypeId : null,
          customerId: s.customer?.id ?? null,
          paid,
          settlementAccount: paid ? e.account : '挂账',
          name: s.name, quantity: s.quantity, unit: s.unit || s.matchedProduct?.unit || '件',
          totalAmount: amount(s.quantity, e.unitPrice, s.totalAmount), unitPrice: e.unitPrice,
          matched: !!s.matchedProduct,
        }]
      })
      const purchasesBody = resp.purchases.flatMap((p, i) => {
        const e = purEdit[i]
        if (!e?.on) return []
        const createProduct = !p.matchedProduct && !!buildFile[`p${i}`] && !!createTypeId
        const totalCost = amount(p.quantity, e.unitCost, p.totalCost)
        return [{
          productId: p.matchedProduct?.id ?? null, skuId: e.skuId,
          createProduct, expenseOnly: !p.matchedProduct && !createProduct,
          productTypeId: createProduct ? createTypeId : null,
          supplierId: e.supplierId,
          paidAmount: e.paidAmount ?? (e.account === '挂账' ? 0 : totalCost),
          settlementAccount: e.account,
          name: p.name, quantity: p.quantity, unit: p.unit || '件',
          totalCost, unitCost: e.unitCost,
        }]
      })
      for (const sale of salesBody) {
        if (!sale.matched && sale.unitPrice == null && sale.totalAmount == null) return message.warning(t(`「${sale.name}」请填写真实售价`, `Enter the actual sale price for "${sale.name}"`))
        if (sale.matched && !sale.skuId) return message.warning(t(`「${sale.name}」请选择销售规格`, `Select a variant for "${sale.name}"`))
        if (!sale.matched && !sale.createProduct && !sale.paid) return message.warning(t(`「${sale.name}」挂账销售需先建档或匹配商品`, `Create or match a product for the credit sale "${sale.name}"`))
        if ((sale.unitPrice != null && (!Number.isFinite(sale.unitPrice) || sale.unitPrice < 0)) || (sale.totalAmount != null && (!Number.isFinite(sale.totalAmount) || sale.totalAmount < 0))) return message.warning(t('销售金额须为有效非负数', 'Enter a valid non-negative sales amount'))
      }
      for (const purchase of purchasesBody) {
        if (purchase.productId && !purchase.skuId) return message.warning(t(`「${purchase.name}」请选择进货规格`, `Select a variant for "${purchase.name}"`))
        if (purchase.totalCost == null || !Number.isFinite(purchase.totalCost) || purchase.totalCost < 0) return message.warning(t(`「${purchase.name}」请填写真实进价`, `Enter the actual cost for "${purchase.name}"`))
        if (purchase.paidAmount == null || !Number.isFinite(purchase.paidAmount) || purchase.paidAmount < 0 || purchase.paidAmount > purchase.totalCost) return message.warning(t('已付金额须在0到应付金额之间', 'Paid amount must be between zero and the total'))
        if (purchase.settlementAccount === '挂账' && purchase.paidAmount !== 0) return message.warning(t('挂账不能填写付款额', 'On-credit purchases cannot include a payment'))
        if (purchase.expenseOnly && (purchase.totalCost <= 0 || purchase.paidAmount !== purchase.totalCost)) return message.warning(t('仅记支出必须是已全额支付的花销；赊购请先建档', 'Expense-only entries must be fully paid; create a product for credit purchases'))
        if (purchase.paidAmount < purchase.totalCost && !purchase.supplierId) return message.warning(t('有欠款时必须选择供应商', 'Select a supplier for an outstanding balance'))
      }
      const expenses = resp.expenses.filter((_, i) => expOn[i]).map((x) => ({ category: x.category, amount: x.amount, note: x.note }))
      const aggregates = resp.aggregates.filter((_, i) => aggOn[i]).map((x) => ({ label: x.label, amount: x.amount, note: x.note }))
      if (!salesBody.length && !purchasesBody.length && !expenses.length && !aggregates.length) return message.warning(t('没有勾选任何一条', 'Nothing is selected'))
      body = { requestId: crypto.randomUUID(), purchases: purchasesBody, sales: salesBody.map(({ matched: _matched, ...row }) => row), expenses, aggregates }
      pending.current = body
    }
    const saveError = storage.write({ ...snapshot(), pending: body })
    setStorageError(saveError)
    setFrozen(true)
    if (saveError) return
    const identity = sessionSnapshot()
    const ticket = ++version.current
    const current = () => ticket === version.current && isCurrentSession(identity)
    inFlight.current = true
    setCommitting(true)
    setFrozen(true)
    setConfirmError(null)
    try {
      const result = await api.post<ConfirmResp>('/ai/confirm-entry', body)
      if (!current()) return
      setStorageError(storage.write({ ...snapshot(), done: result, pending: body }))
      setDone(result)
      pending.current = body
      setFrozen(false)
      refreshEntitlement()
      message.success(t('已入账', 'Recorded'))
    } catch (e) {
      if (!current()) return
      setConfirmError((e as Error).message)
      // 400校验失败、404对象不存在均已整批回滚；网络/5xx/409不能当成未入账。
      if ([400, 404].includes((e as { status?: number }).status ?? 0)) { pending.current = null; setFrozen(false) }
      if (!handleAiQuotaError(e, modal, isAdmin)) message.error((e as Error).message)
    } finally {
      if (current()) { inFlight.current = false; setCommitting(false) }
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
          <Select disabled={!!done || frozen || parsing} value={mode} onChange={setMode} options={MODES} style={{ width: 280 }} />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={parsing} disabled={!!done || frozen || parsing} onClick={parse}>
            {parsing ? t('AI 解析中…', 'AI parsing…') : t('AI 解析', 'AI parse')}
          </Button>
          <AiQuotaTag bucket="core" />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              '只出草案，确认才落库；AI 绝不编成本价，退货不碰',
              'Drafts only — nothing is saved until you confirm. AI never invents cost prices and never touches returns.',
            )}
          </Typography.Text>
        </div>
        <Input.TextArea disabled={!!done || frozen || parsing} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} autoSize={{ minRows: 5, maxRows: 12 }} style={{ fontSize: 14 }} />
      </div>

      {storageError && <Alert type="error" showIcon message={storageError} />}
      {saved && (saved.text || saved.resp) && !done && <Alert type="info" message={t('已恢复本账号草稿；待确认的记录会使用原编号重试。', 'Your draft was restored. Pending entries retry with their original ID.')} />}
      {lookupError && <Alert type="error" showIcon message={lookupError} />}
      {resp && !done && (
        <div style={{ ...cardStyle, padding: 20 }}>
          {confirmError && <Alert type="warning" showIcon message={confirmError} description={frozen ? t('确认结果尚不明确，草案已锁定。请重试同一笔确认，不要另建重复单。', 'The confirmation result is uncertain. This draft is locked; retry this same entry to avoid duplicates.') : t('本次未入账，请修正草案后确认。', 'Nothing was recorded. Correct the draft and confirm again.')} />}
          <fieldset disabled={frozen} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {resp.warnings.length > 0 && (
            <Alert
              style={{ marginBottom: 14 }}
              type="warning"
              showIcon
              message={t('AI 的提示（请人工处理）', 'AI notes (needs your attention)')}
              description={<ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>{resp.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            />
          )}

          {resp.sales.length > 0 && (
            <Section title={t(`销售 ${resp.sales.length} 笔`, `Sales · ${resp.sales.length}`)}>
              <Table<SaleDraft>
                rowKey={(_, i) => `s${i}`}
                size="small"
                pagination={false}
                scroll={{ x: 1100 }}
                dataSource={resp.sales}
                columns={[
                  {
                    title: t('入账', 'Record'),
                    width: 50,
                    render: (_, __, i) => <Checkbox disabled={frozen} checked={saleEdit[i]?.on} onChange={(e) => setSaleEdit((p) => ({ ...p, [i]: { ...p[i], on: e.target.checked } }))} />,
                  },
                  {
                    title: t('商品', 'Product'),
                    render: (_, s, i) => (
                      <span>
                        {s.name} <span style={{ color: T.secondary }}>×{fmtQty(s.quantity)}{s.unit}</span>
                        {s.matchedProduct ? (
                          <Tag color="green" style={{ marginLeft: 6 }}>{t('已认出', 'Matched')}</Tag>
                        ) : (
                          <>
                            <Tag color="orange" style={{ marginLeft: 6 }}>
                              {buildFile[`s${i}`] ? t('新建商品并扣库存', 'Create product and deduct stock') : t('没档案·仅已收款可记收入', 'No product record · paid income only')}
                            </Tag>
                            <Checkbox
                              checked={!!buildFile[`s${i}`]}
                              disabled={frozen || !createTypeId}
                              onChange={(e) => setBuildFile((p) => ({ ...p, [`s${i}`]: e.target.checked }))}
                              style={{ marginLeft: 4, fontSize: 12 }}
                            >
                              <span style={{ fontSize: 12 }}>
                                {createTypeId
                                  ? t(
                                      `顺便建档到「${createTypeName}」并扣库存`,
                                      `Also create it under "${createTypeName}" & deduct stock`,
                                    )
                                  : t('先建品类才能建档', 'Create a category first')}
                              </span>
                            </Checkbox>
                          </>
                        )}
                      </span>
                    ),
                  },
                  { title: t('规格', 'Variant'), render: (_, row, i) => row.matchedProduct?.skus?.length ? <Select disabled={frozen} value={saleEdit[i]?.skuId} placeholder={t('选择规格', 'Select variant')} options={row.matchedProduct.skus.map((sku) => ({ value: sku.id, label: sku.specText || t('默认规格', 'Default variant') }))} onChange={(skuId) => setSaleEdit((prev) => ({ ...prev, [i]: { ...prev[i], skuId } }))} style={{ minWidth: 100 }} /> : '-' },
                  { title: t('客户', 'Customer'), width: 90, render: (_, s) => s.customer?.name ?? t('散客', 'Walk-in') },
                  {
                    title: t('单价', 'Unit price'),
                    width: 110,
                    render: (_, __, i) => (
                      <Input
                        size="small"
                        disabled={frozen}
                        prefix="¥"
                        value={saleEdit[i]?.unitPrice ?? ''}
                        placeholder={t('按标价', 'List price')}
                        onChange={(e) => { const v = e.target.value.trim(); setSaleEdit((p) => ({ ...p, [i]: { ...p[i], unitPrice: v === '' ? null : Number(v) } })) }}
                        style={{ width: 90 }}
                      />
                    ),
                  },
                  { title: t('金额', 'Amount'), render: (_, row, i) => { const value = amount(row.quantity, saleEdit[i]?.unitPrice ?? null, row.totalAmount); return value == null ? '-' : fmtMoney(value) } },
                  { title: t('收款账户', 'Account'), render: (_, row, i) => { const paid = saleEdit[i]?.paid ?? !(row.customer && row.customer.name !== '散客'); return <Select disabled={frozen || !paid} value={paid ? saleEdit[i]?.account : '挂账'} options={(paid ? ACCOUNTS : ['挂账']).map((value) => ({ value, label: value }))} onChange={(account) => setSaleEdit((prev) => ({ ...prev, [i]: { ...prev[i], account } }))} style={{ minWidth: 90 }} /> } },
                  {
                    // 列头解释规则，选项里只说结果——"没提"这种系统视角的词用户看不懂
                    title: (
                      <span>
                        {t('收款', 'Payment')}{' '}
                        <Tooltip
                          title={t(
                            '口述里没说收没收钱时：散客默认按已收款，记名客户默认记挂账（月结常态，防止把没收的钱记成收了）',
                            'When the note does not say whether you were paid: walk-in customers default to paid, named customers default to on credit (monthly settlement is the norm, so unpaid money is never recorded as received).',
                          )}
                        >
                          <QuestionCircleOutlined style={{ color: T.secondary, fontSize: 12 }} />
                        </Tooltip>
                      </span>
                    ),
                    width: 140,
                    render: (_, s, i) => (
                      <Select
                        size="small"
                        disabled={frozen}
                        value={saleEdit[i]?.paid === true ? 'paid' : saleEdit[i]?.paid === false ? 'credit' : 'unknown'}
                        onChange={(v) => setSaleEdit((p) => ({ ...p, [i]: { ...p[i], paid: v === 'paid' ? true : v === 'credit' ? false : null } }))}
                        options={[
                          { value: 'paid', label: t('已收款', 'Paid') },
                          { value: 'credit', label: t('挂账（先欠着）', 'On credit (owed)') },
                          // 落账默认：散客当场结清、记名客户挂账。AI 把口述里的"散客"匹配到内置散客档案时不算记名客户
                          {
                            value: 'unknown',
                            label:
                              s.customer && s.customer.name !== '散客'
                                ? t('默认：挂账', 'Default: on credit')
                                : t('默认：已收款', 'Default: paid'),
                          },
                        ]}
                        style={{ width: 128 }}
                      />
                    ),
                  },
                ]}
              />
            </Section>
          )}

          {resp.purchases.length > 0 && (
            <Section title={t(`进货 ${resp.purchases.length} 笔`, `Purchases · ${resp.purchases.length}`)}>
              <Table<PurchaseDraft>
                rowKey={(_, i) => `p${i}`}
                size="small"
                pagination={false}
                scroll={{ x: 1100 }}
                dataSource={resp.purchases}
                columns={[
                  { title: t('入账', 'Record'), width: 50, render: (_, __, i) => <Checkbox disabled={frozen} checked={purEdit[i]?.on} onChange={(e) => setPurEdit((p) => ({ ...p, [i]: { ...p[i], on: e.target.checked } }))} /> },
                  {
                    title: t('商品', 'Product'),
                    render: (_, p, i) => (
                      <span>
                        {p.name} <span style={{ color: T.secondary }}>×{fmtQty(p.quantity)}{p.unit}</span>
                        {p.matchedProduct ? (
                          <Tag color="green" style={{ marginLeft: 6 }}>{t('已认出', 'Matched')}</Tag>
                        ) : (
                          <>
                            <Tag color="orange" style={{ marginLeft: 6 }}>
                              {buildFile[`p${i}`] ? t('新建商品并入库', 'Create product and receive stock') : t('没档案·仅记已付支出，不入库存', 'No product record · paid expense only, no stock')}
                            </Tag>
                            <Checkbox
                              checked={!!buildFile[`p${i}`]}
                              disabled={frozen || !createTypeId}
                              onChange={(e) => setBuildFile((prev) => ({ ...prev, [`p${i}`]: e.target.checked }))}
                              style={{ marginLeft: 4 }}
                            >
                              <span style={{ fontSize: 12 }}>
                                {createTypeId
                                  ? t(
                                      `顺便建档到「${createTypeName}」并入库`,
                                      `Also create it under "${createTypeName}" & add to stock`,
                                    )
                                  : t('先建品类才能建档', 'Create a category first')}
                              </span>
                            </Checkbox>
                          </>
                        )}
                      </span>
                    ),
                  },
                  { title: t('规格', 'Variant'), render: (_, row, i) => row.matchedProduct ? <Select disabled={frozen} value={purEdit[i]?.skuId} placeholder={t('选择规格', 'Select variant')} options={(row.matchedProduct.skus ?? []).map((sku) => ({ value: sku.id, label: sku.specText || t('默认规格', 'Default variant') }))} onChange={(skuId) => setPurEdit((prev) => ({ ...prev, [i]: { ...prev[i], skuId } }))} style={{ minWidth: 100 }} /> : '-' },
                  { title: t('供应商', 'Supplier'), render: (_, __, i) => <Select disabled={frozen} allowClear showSearch optionFilterProp="label" value={purEdit[i]?.supplierId} placeholder={t('有欠款必选', 'Required for credit')} options={suppliers.map((party) => ({ value: party.id, label: party.name }))} onChange={(supplierId) => setPurEdit((prev) => ({ ...prev, [i]: { ...prev[i], supplierId: supplierId ?? null } }))} style={{ minWidth: 120 }} /> },
                  { title: t('付款账户', 'Account'), render: (_, __, i) => <Select disabled={frozen} value={purEdit[i]?.account} options={[...ACCOUNTS, '挂账'].map((value) => ({ value, label: value }))} onChange={(account) => setPurEdit((prev) => ({ ...prev, [i]: { ...prev[i], account, paidAmount: account === '挂账' ? 0 : null } }))} style={{ minWidth: 90 }} /> },
                  { title: t('已付', 'Paid'), render: (_, row, i) => <Input disabled={frozen || purEdit[i]?.account === '挂账'} value={purEdit[i]?.paidAmount ?? ''} placeholder={String(amount(row.quantity, purEdit[i]?.unitCost ?? null, row.totalCost) ?? '')} onChange={(e) => setPurEdit((prev) => ({ ...prev, [i]: { ...prev[i], paidAmount: e.target.value.trim() === '' ? null : Number(e.target.value) } }))} style={{ width: 80 }} /> },
                  {
                    title: t('进价', 'Cost price'),
                    width: 110,
                    render: (_, __, i) => (
                      <Input
                        size="small"
                        disabled={frozen}
                        prefix="¥"
                        value={purEdit[i]?.unitCost ?? ''}
                        placeholder={t('单价', 'Unit price')}
                        onChange={(e) => { const v = e.target.value.trim(); setPurEdit((p) => ({ ...p, [i]: { ...p[i], unitCost: v === '' ? null : Number(v) } })) }}
                        style={{ width: 90 }}
                      />
                    ),
                  },
                  { title: t('总花费', 'Total cost'), width: 90, render: (_, p, i) => { const value = amount(p.quantity, purEdit[i]?.unitCost ?? null, p.totalCost); return value == null ? '-' : fmtMoney(value) } },
                ]}
              />
            </Section>
          )}

          {resp.expenses.length > 0 && (
            <Section title={t(`支出 ${resp.expenses.length} 笔`, `Expenses · ${resp.expenses.length}`)}>
              {resp.expenses.map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 13 }}>
                  <Checkbox disabled={frozen} checked={expOn[i]} onChange={(e) => setExpOn((p) => ({ ...p, [i]: e.target.checked }))} />
                  <Tag>{x.category}</Tag>
                  <b>{fmtMoney(x.amount)}</b>
                  {x.note && <span style={{ color: T.secondary }}>{x.note}</span>}
                </div>
              ))}
            </Section>
          )}

          {resp.aggregates.length > 0 && (
            <Section title={t(`营业额汇总 ${resp.aggregates.length} 笔`, `Revenue totals · ${resp.aggregates.length}`)}>
              {resp.todayContext && resp.todayContext.ordersTotal + resp.todayContext.incomesTotal > 0 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message={t(
                    `今天已记 ${resp.todayContext.ordersCount} 张订单 ¥${resp.todayContext.ordersTotal}${resp.todayContext.incomesTotal ? ` + 其他收入 ¥${resp.todayContext.incomesTotal}` : ''}——这笔汇总别和它们重复入账`,
                    `Already recorded today: ${resp.todayContext.ordersCount} orders ¥${resp.todayContext.ordersTotal}${resp.todayContext.incomesTotal ? ` + other income ¥${resp.todayContext.incomesTotal}` : ''} — make sure this total does not double-count them`,
                  )}
                />
              )}
              {resp.aggregates.map((x, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 13 }}>
                  <Checkbox disabled={frozen} checked={aggOn[i]} onChange={(e) => setAggOn((p) => ({ ...p, [i]: e.target.checked }))} />
                  <span>{x.label}</span>
                  <b>{fmtMoney(x.amount)}</b>
                  {x.note && <span style={{ color: T.secondary }}>{x.note}</span>}
                </div>
              ))}
            </Section>
          )}

          {totalItems === 0 && resp.warnings.length === 0 && (
            <Empty description={t('没解析出可入账的内容', 'Nothing to record was parsed')} />
          )}

          </fieldset>
          {totalItems > 0 && (
            <Button type="primary" icon={<CheckCircleOutlined />} loading={committing} disabled={committing} onClick={commit} style={{ marginTop: 10 }}>
              {t('确认入账勾选的项', 'Record the selected items')}
            </Button>
          )}
        </div>
      )}

      {done && (
        <div style={{ ...cardStyle, padding: 20 }}>
          <Typography.Text strong style={{ fontSize: 16, color: T.emerald }}>
            {t('✓ 已入账', '✓ Recorded')}
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
            {t(
              '已匹配或新建商品的销售生成订单、采购生成进货单；仅记收入/支出及营业额进入流水。去对应页面可查。',
              'Matched or newly created products generated sales or purchase orders; income-only, expense-only and revenue entries went into the ledger. Review them on the corresponding pages.',
            )}
          </Typography.Paragraph>
          {done.replayed && <Typography.Paragraph>{t('这笔之前已入账，本次返回原结果，没有重复记账。', 'This entry was already recorded. The original result was returned without recording it again.')}</Typography.Paragraph>}
          {done.orders?.map((order) => <div key={`sale${order.id}`} style={{ marginTop: 8 }}>{t('销售单 ', 'Sale ')}{order.orderNo} · {fmtMoney(order.actualAmount)} · {t('待收 ', 'Due ')}{fmtMoney(order.unpaidAmount)}</div>)}
          {done.purchaseOrders?.map((order) => <div key={`purchase${order.id}`} style={{ marginTop: 8 }}>{t('进货单 ', 'Purchase ')}{order.orderNo} · {fmtMoney(order.actualAmount)} · {t('待付 ', 'Payable ')}{fmtMoney(order.unpaidAmount)}</div>)}
          {done.incomes?.map((entry) => <div key={`income${entry.id}`} style={{ marginTop: 8 }}>{t('收入 ', 'Income ')}#{entry.id} · {entry.source} · {fmtMoney(entry.amount)}</div>)}
          {done.expenses?.map((entry) => <div key={`expense${entry.id}`} style={{ marginTop: 8 }}>{t('支出 ', 'Expense ')}#{entry.id} · {entry.note || entry.category} · {fmtMoney(entry.amount)}</div>)}
          {!!done.negativeStock?.length && <Alert type="warning" showIcon message={t('部分商品已出现负库存，请到商品页核对并补录库存。', 'Some products now have negative stock. Review and update their inventory on the Products page.')} />}
          <Button style={{ marginTop: 12 }} onClick={() => { const error = storage.write({ ...snapshot(), text: '', resp: null, done: null, pending: null, buildFile: {} }); setStorageError(error); if (error) return; setResp(null); setDone(null); setText(''); setBuildFile({}); setConfirmError(null); pending.current = null; setFrozen(false) }}>
            {t('再记一笔', 'Record another')}
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
