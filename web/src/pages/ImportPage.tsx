import { Alert, App, Button, Input, Select, Steps, Table, Tag, Typography } from 'antd'
import { CheckCircleOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import api from '../api/client'
import { useAuth } from '../auth'
import { fmtMoney, fmtQty } from '../lib/format'
import { t } from '../lib/i18n'
import { AiQuotaTag, handleAiQuotaError } from '../components/AiQuota'
import { refreshEntitlement } from '../hooks/useEntitlement'
import { T, cardStyle } from '../theme'

interface ProductType {
  id: number
  name: string
}
interface DraftSku {
  specValues: Record<string, string>
  price: number
  costPrice?: number
  barcode?: string
  initQuantity: number
}
interface DraftProduct {
  name: string
  unit: string
  customFields: Record<string, unknown>
  skus: DraftSku[]
}
interface ImportResp {
  productTypeId: number
  typeName: string
  products: DraftProduct[]
  skipped: string[]
}
interface BatchResp {
  created: { id: number; name: string }[]
  failed: { name: string; error: string }[]
}

const PLACEHOLDER = t(
  `把 Excel 里的商品直接整片复制过来，或粘贴任意格式的清单文字，例如：

泸州老窖 52度 500ml  进价98 卖128  库存24瓶
老村长 42度  15元一瓶 60瓶
长城干红 750ml x6 整箱卖288，成本 210，有 8 箱
……

AI 会解析成商品草案，你确认后才会入库。解析不了的行会原样列出来，绝不瞎编。`,
  `Paste a whole block straight out of Excel, or any free-form product list, for example:

Highland Whisky 40% 500ml  cost 98 sell 128  stock 24 bottles
Village Lager 42%  15 each, 60 bottles
Great Wall Red 750ml x6  case sells 288, cost 210, 8 cases
…

AI turns this into draft products; nothing is saved until you confirm. Lines it cannot read are listed as-is — it never makes things up.`,
)

export default function ImportPage() {
  const { message, modal } = App.useApp()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [types, setTypes] = useState<ProductType[]>([])
  const [typeId, setTypeId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<ImportResp | null>(null)
  const [selected, setSelected] = useState<React.Key[]>([])
  const [committing, setCommitting] = useState(false)

  // 粘贴的清单/解析出的草案还没入库时，误刷新/误关标签要拦一下（几百行 Excel 白粘了最伤人）
  useEffect(() => {
    const dirty = text.trim().length > 0 || result !== null
    if (!dirty) return
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [text, result])
  const [done, setDone] = useState<BatchResp | null>(null)

  useEffect(() => {
    api
      .get<ProductType[] | { list: ProductType[] }>('/product-types')
      .then((d) => setTypes(Array.isArray(d) ? d : d.list))
      .catch(() => {})
  }, [])

  const parse = async () => {
    if (!typeId) return message.warning(t('先选品类——AI 需要按品类字段解析', 'Pick a category first — AI parses against its fields'))
    if (text.trim().length < 2) return message.warning(t('先粘贴商品数据', 'Paste your product data first'))
    setParsing(true)
    setResult(null)
    setDone(null)
    try {
      const r = await api.post<ImportResp>('/ai/import-products', { productTypeId: typeId, text })
      setResult(r)
      setSelected(r.products.map((_, i) => String(i))) // 与 rowKey 同为字符串，防勾选态失联
      refreshEntitlement()
      if (r.products.length === 0)
        message.warning(t('AI 没解析出任何商品，看看下面的未解析清单', 'AI found no products — check the unparsed lines below'))
    } catch (e) {
      if (!handleAiQuotaError(e, modal, isAdmin)) message.error((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  const commit = async () => {
    if (!result || !typeId) return
    const chosen = result.products.filter((_, i) => selected.includes(String(i)))
    if (chosen.length === 0) return message.warning(t('至少勾选一个商品', 'Select at least one product'))
    setCommitting(true)
    try {
      const r = await api.post<BatchResp>('/products/batch', { productTypeId: typeId, products: chosen })
      setDone(r)
      if (r.failed.length === 0) message.success(t(`已入库 ${r.created.length} 个商品`, `${r.created.length} products imported`))
      else
        message.warning(
          t(
            `入库 ${r.created.length} 个，失败 ${r.failed.length} 个（见下方）`,
            `${r.created.length} imported, ${r.failed.length} failed (see below)`,
          ),
        )
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setCommitting(false)
    }
  }

  const step = done ? 2 : result ? 1 : 0

  const draftColumns = useMemo(
    () => [
      { title: t('商品', 'Product'), dataIndex: 'name', render: (v: string) => <b>{v}</b> },
      { title: t('单位', 'Unit'), dataIndex: 'unit', width: 60 },
      {
        title: t('规格 / 价格 / 初始库存', 'Variant / price / opening stock'),
        key: 'skus',
        render: (_: unknown, p: DraftProduct) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {p.skus.map((s, i) => (
              <span key={i} style={{ fontSize: 12.5 }}>
                {Object.values(s.specValues).length > 0 && (
                  <Tag style={{ borderRadius: 999, fontSize: 11 }}>{Object.values(s.specValues).join(' · ')}</Tag>
                )}
                {t('卖 ', 'Sell ')}
                <b>{fmtMoney(s.price)}</b>
                {s.costPrice != null && (
                  <span style={{ color: T.secondary }}>
                    {t(' / 进 ', ' / cost ')}
                    {fmtMoney(s.costPrice)}
                  </span>
                )}
                {s.initQuantity > 0 && (
                  <span style={{ color: T.secondary }}>
                    {' '}
                    {t('/ 库存 ', '/ stock ')}
                    {fmtQty(s.initQuantity)}
                    {p.unit}
                  </span>
                )}
                {s.costPrice == null && (
                  <span style={{ color: T.orange, fontSize: 11 }}>{t('（没提取到进价）', ' (no cost price found)')}</span>
                )}
              </span>
            ))}
          </div>
        ),
      },
      {
        title: t('品类字段', 'Category fields'),
        key: 'cf',
        width: 220,
        render: (_: unknown, p: DraftProduct) => {
          const entries = Object.entries(p.customFields).filter(([, v]) => v !== '' && v != null)
          return entries.length === 0 ? (
            <span style={{ color: T.secondary, fontSize: 12 }}>-</span>
          ) : (
            <span style={{ fontSize: 12, color: T.onSurfaceVariant }}>
              {entries.map(([k, v]) => `${k}:${String(v)}`).join(t('，', ', '))}
            </span>
          )
        },
      },
    ],
    [],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 980 }}>
      <Steps
        size="small"
        current={step}
        items={[
          { title: t('粘贴数据', 'Paste data') },
          { title: t('确认草案', 'Confirm draft') },
          { title: t('入库完成', 'Imported') },
        ]}
        style={{ maxWidth: 560 }}
      />

      <div style={{ ...cardStyle, padding: 24 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select
            placeholder={t('商品属于哪个品类', 'Which category are these in?')}
            value={typeId}
            onChange={setTypeId}
            options={types.map((t) => ({ value: t.id, label: t.name }))}
            style={{ width: 200 }}
          />
          <Button type="primary" icon={<ThunderboltOutlined />} loading={parsing} onClick={parse}>
            {parsing ? t('AI 解析中（10~30 秒）', 'AI parsing (10–30s)') : t('AI 解析', 'AI parse')}
          </Button>
          <AiQuotaTag bucket="other" />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              '只出草案，你确认才入库；AI 绝不编造进价',
              'Drafts only — nothing is saved until you confirm, and AI never invents a cost price',
            )}
          </Typography.Text>
        </div>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          autoSize={{ minRows: 8, maxRows: 16 }}
          style={{ fontFamily: 'monospace', fontSize: 13 }}
        />
      </div>

      {result && (
        <div style={{ ...cardStyle, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <Typography.Text strong style={{ fontSize: 16 }}>
              {t(
                `解析草案：${result.products.length} 个商品（品类：${result.typeName}）`,
                `Draft: ${result.products.length} products (category: ${result.typeName})`,
              )}
            </Typography.Text>
            {!done && result.products.length > 0 && (
              <Button type="primary" icon={<CheckCircleOutlined />} loading={committing} onClick={commit}>
                {t(`入库勾选的 ${selected.length} 个`, `Import ${selected.length} selected`)}
              </Button>
            )}
          </div>
          {result.products.length > 0 && (
            <Table<DraftProduct>
              rowKey={(_, i) => String(i)}
              dataSource={result.products}
              columns={draftColumns}
              size="small"
              pagination={false}
              rowSelection={done ? undefined : { selectedRowKeys: selected, onChange: setSelected }}
            />
          )}
          {result.skipped.length > 0 && (
            <Alert
              style={{ marginTop: 14 }}
              type="warning"
              showIcon
              message={t(
                `有 ${result.skipped.length} 条没解析进草案（AI 看不懂或清洗层拦下），请人工处理：`,
                `${result.skipped.length} lines did not make it into the draft (AI could not read them, or the sanitizer blocked them) — handle these manually:`,
              )}
              description={
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                  {result.skipped.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              }
            />
          )}
        </div>
      )}

      {done && (
        <div style={{ ...cardStyle, padding: 24 }}>
          <Typography.Text strong style={{ fontSize: 16, color: T.emerald }}>
            {t(`✓ 已入库 ${done.created.length} 个商品`, `✓ ${done.created.length} products imported`)}
          </Typography.Text>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
            {done.created.map((c) => c.name).join(t('、', ', '))}
          </Typography.Paragraph>
          {done.failed.length > 0 && (
            <Alert
              style={{ marginTop: 12 }}
              type="error"
              showIcon
              message={t(`失败 ${done.failed.length} 个`, `${done.failed.length} failed`)}
              description={
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                  {done.failed.map((f, i) => (
                    <li key={i}>
                      {f.name}
                      {t('：', ': ')}
                      {f.error}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          <div style={{ marginTop: 12 }}>
            <Button
              onClick={() => {
                setResult(null)
                setDone(null)
                setText('')
              }}
            >
              {t('再导一批', 'Import another batch')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
