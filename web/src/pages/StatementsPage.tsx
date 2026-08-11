import { Alert, Button, DatePicker, Empty, Select, Skeleton, Typography } from 'antd'
import { PrinterOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { useAuth } from '../auth'
import { fmtMoney } from '../lib/format'
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
        ? { debit: '应收', credit: '收款', opening: '期初欠款', closing: '期末欠款', title: '客户对账单' }
        : { debit: '应付', credit: '付款', opening: '期初应付', closing: '期末应付', title: '供应商对账单' },
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
              {m === 'customer' ? '客户对账单' : '供应商对账单'}
            </span>
          ))}
        </div>
        <Select
          showSearch
          placeholder={isCustomer ? '选客户（欠款多的在前）' : '选供应商'}
          value={partyId}
          onChange={setPartyId}
          optionFilterProp="label"
          style={{ width: 240 }}
          options={parties.map((p) => ({
            value: p.id,
            label: `${p.name}${isCustomer && (p.owed ?? 0) > 0 ? `（欠 ${fmtMoney(p.owed!)}）` : ''}`,
          }))}
        />
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
        />
        <Button type="primary" icon={<PrinterOutlined />} disabled={!data} onClick={() => window.print()}>
          打印 / 存 PDF
        </Button>
      </div>

      {error && <Alert className="no-print" type="warning" message={error} showIcon />}
      {!partyId && !error && (
        <Empty className="no-print" style={{ paddingTop: 80 }} description={`选一个${isCustomer ? '客户' : '供应商'}生成对账单`} />
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
              {isCustomer ? '客户' : '供应商'}：<b style={{ color: '#111' }}>{party.name}</b>
              {party.phone ? `（${party.phone}）` : ''}
            </span>
            <span>
              账期：{range[0].format('YYYY-MM-DD')} ~ {range[1].format('YYYY-MM-DD')}
            </span>
            <span>打印时间：{dayjs().format('YYYY-MM-DD HH:mm')}</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #999', textAlign: 'left', color: '#555' }}>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>日期</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>类型</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>单号/账户</th>
                <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>{labels.debit}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>{labels.credit}</th>
                <th style={{ padding: '6px 4px', fontWeight: 600 }}>备注</th>
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
                    本期无往来
                  </td>
                </tr>
              )}
              <tr style={{ borderTop: '1px solid #999' }}>
                <td colSpan={3} style={{ padding: '7px 4px', fontWeight: 600 }}>
                  本期合计
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
            <span>制单（盖章）：____________</span>
            <span>对方确认（签字）：____________</span>
          </div>
          <Typography.Paragraph style={{ fontSize: 11, color: '#999', marginTop: 18, marginBottom: 0 }}>
            说明：单据金额为开单时原始金额，退货以「退货冲减」行核销；如对账目有疑问，请在收到本单 7 日内提出。
          </Typography.Paragraph>
        </div>
      )}
    </div>
  )
}
