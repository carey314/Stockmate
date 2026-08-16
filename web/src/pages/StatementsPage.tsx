import { Alert, Button, DatePicker, Empty, Select, Skeleton, Typography } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { useAuth } from '../auth'
import { fmtMoney } from '../lib/format'
import { t } from '../lib/i18n'
import { T, cardStyle } from '../theme'

interface Party {
  id: number
  name: string
  phone: string | null
  owed?: number
}
interface StatementRow {
  at: string
  type: string
  ref: string
  debit: number
  credit: number
  note: string | null
}
interface Statement {
  customer?: { id: number; name: string; phone: string | null; address?: string | null }
  supplier?: { id: number; name: string; phone: string | null }
  opening: number
  periodDebit: number
  periodCredit: number
  closing: number
  rows: StatementRow[]
}

type Mode = 'customer' | 'supplier'

export default function StatementsPage() {
  const { profile } = useAuth()
  const [mode, setMode] = useState<Mode>('customer')
  const [parties, setParties] = useState<Party[]>([])
  const [partyId, setPartyId] = useState<number | null>(null)
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()])
  const [data, setData] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 切换客户/供应商时拉对象列表（客户按欠款降序，欠钱的排前面）
  useEffect(() => {
    setPartyId(null)
    setData(null)
    api
      .get<{ list: Party[] }>(mode === 'customer' ? '/customers' : '/suppliers', { page: 1, pageSize: 200 })
      .then((d) => {
        const list = [...d.list]
        if (mode === 'customer') list.sort((a, b) => (b.owed ?? 0) - (a.owed ?? 0))
        setParties(list)
      })
      .catch((e) => setError((e as Error).message))
  }, [mode])

  useEffect(() => {
    if (!partyId) return
    let alive = true
    setLoading(true)
    setError(null)
    api
      .get<Statement>(mode === 'customer' ? '/reports/customer-statement' : '/reports/supplier-statement', {
        [mode === 'customer' ? 'customerId' : 'supplierId']: partyId,
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
      })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [mode, partyId, range])

  const party = data?.customer ?? data?.supplier
  const isCustomer = mode === 'customer'
  const labels = useMemo(
    () =>
      isCustomer
        ? {
            debit: t('应收', 'Receivable'),
            credit: t('收款', 'Received'),
            opening: t('期初欠款', 'Opening balance due'),
            closing: t('期末欠款', 'Closing balance due'),
            title: t('客户对账单', 'Customer Statement'),
          }
        : {
            debit: t('应付', 'Payable'),
            credit: t('付款', 'Paid'),
            opening: t('期初应付', 'Opening balance payable'),
            closing: t('期末应付', 'Closing balance payable'),
            title: t('供应商对账单', 'Supplier Statement'),
          },
    [isCustomer],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 工具行（打印时隐藏）*/}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['customer', 'supplier'] as Mode[]).map((m) => (
            <span
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === m ? T.surfaceContainerLow : T.surfaceContainer,
                color: mode === m ? T.primary : T.secondary,
                border: mode === m ? `1px solid ${T.primary}33` : '1px solid transparent',
              }}
            >
              {m === 'customer' ? t('客户对账单', 'Customer Statement') : t('供应商对账单', 'Supplier Statement')}
            </span>
          ))}
        </div>
        <Select
          showSearch
          placeholder={
            isCustomer
              ? t('选客户（欠款多的在前）', 'Pick a customer (largest balance first)')
              : t('选供应商', 'Pick a supplier')
          }
          value={partyId}
          onChange={setPartyId}
          optionFilterProp="label"
          style={{ width: 240 }}
          options={parties.map((p) => ({
            value: p.id,
            label: `${p.name}${
              isCustomer && (p.owed ?? 0) > 0
                ? t(`（欠 ${fmtMoney(p.owed!)}）`, ` (owes ${fmtMoney(p.owed!)})`)
                : ''
            }`,
          }))}
        />
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
        />
        <Button type="primary" icon={<PrinterOutlined />} disabled={!data} onClick={() => window.print()}>
          {t('打印 / 存 PDF', 'Print / Save PDF')}
        </Button>
      </div>

      {error && <Alert className="no-print" type="warning" message={error} showIcon />}
      {!partyId && !error && (
        <Empty
          className="no-print"
          style={{ paddingTop: 80 }}
          description={
            isCustomer
              ? t('选一个客户生成对账单', 'Pick a customer to generate a statement')
              : t('选一个供应商生成对账单', 'Pick a supplier to generate a statement')
          }
        />
      )}
      {loading && <Skeleton active paragraph={{ rows: 8 }} />}

      {/* A4 对账单主体（打印时只剩它）*/}
      {data && party && !loading && (
        <div
          className="print-area"
          style={{
            ...cardStyle,
            padding: '36px 44px',
            maxWidth: 820,
            background: '#fff',
            color: '#111',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{profile?.shopName ?? ''}</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{labels.title}</div>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 13,
              color: '#444',
              borderBottom: '2px solid #111',
              paddingBottom: 8,
              marginBottom: 10,
              flexWrap: 'wrap',
              gap: 4,
            }}
          >
            <span>
              {isCustomer ? t('客户：', 'Customer: ') : t('供应商：', 'Supplier: ')}
              <b style={{ color: '#111' }}>{party.name}</b>
              {party.phone ? `（${party.phone}）` : ''}
            </span>
            <span>
              {t('账期：', 'Period: ')}
              {range[0].format('YYYY-MM-DD')} ~ {range[1].format('YYYY-MM-DD')}
            </span>
            <span>
              {t('打印时间：', 'Printed: ')}
              {dayjs().format('YYYY-MM-DD HH:mm')}
            </span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #999', textAlign: 'left', color: '#555' }}>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>{t('日期', 'Date')}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>{t('类型', 'Type')}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>{t('单号/账户', 'Doc No. / Account')}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>{labels.debit}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>{labels.credit}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>{t('备注', 'Note')}</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px dashed #ccc', background: '#fafafa' }}>
                <td colSpan={3} style={{ padding: '7px 4px', fontWeight: 600 }}>
                  {labels.opening}
                </td>
                <td colSpan={3} style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700 }}>
                  {fmtMoney(data.opening)}
                </td>
              </tr>
              {data.rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px dashed #ddd' }}>
                  <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{dayjs(r.at).format('MM-DD HH:mm')}</td>
                  <td style={{ padding: '6px 4px', color: r.credit < 0 ? '#ba1a1a' : undefined }}>{r.type}</td>
                  <td style={{ padding: '6px 4px', fontFamily: 'monospace', fontSize: 12 }}>{r.ref || '-'}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{r.debit ? fmtMoney(r.debit) : '-'}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', color: r.credit < 0 ? '#ba1a1a' : undefined }}>
                    {r.credit ? fmtMoney(r.credit) : '-'}
                  </td>
                  <td style={{ padding: '6px 4px', color: '#666', fontSize: 12 }}>{r.note ?? ''}</td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 14, textAlign: 'center', color: '#888' }}>
                    {t('本期无往来', 'No transactions in this period')}
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid #999' }}>
                <td colSpan={3} style={{ padding: '7px 4px', fontWeight: 600 }}>
                  {t('本期合计', 'Period total')}
                </td>
                <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700 }}>{fmtMoney(data.periodDebit)}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 700 }}>{fmtMoney(data.periodCredit)}</td>
                <td />
              </tr>
              <tr style={{ background: '#f5f5f5' }}>
                <td colSpan={3} style={{ padding: '9px 4px', fontWeight: 700, fontSize: 14 }}>
                  {labels.closing}
                </td>
                <td colSpan={3} style={{ padding: '9px 4px', textAlign: 'right', fontWeight: 700, fontSize: 16 }}>
                  {fmtMoney(data.closing)}
                </td>
              </tr>
            </tbody>
          </table>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 40,
              fontSize: 13,
              color: '#444',
            }}
          >
            <span>{t('制单（盖章）：____________', 'Prepared by (stamp): ____________')}</span>
            <span>{t('对方确认（签字）：____________', 'Confirmed by (signature): ____________')}</span>
          </div>
          <Typography.Paragraph style={{ fontSize: 11, color: '#999', marginTop: 18, marginBottom: 0 }}>
            {t(
              '说明：单据金额为开单时原始金额，退货以「退货冲减」行核销；如对账目有疑问，请在收到本单 7 日内提出。',
              'Note: document amounts are the original amounts at the time of issue; returns are settled through separate reversal rows. Please raise any discrepancy within 7 days of receiving this statement.',
            )}
          </Typography.Paragraph>
        </div>
      )}
    </div>
  )
}
