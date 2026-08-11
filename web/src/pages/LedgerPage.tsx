import {
  App,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Table,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import api from '../api/client'
import { fmtMoney } from '../lib/format'
import { T, cardStyle } from '../theme'

type Mode = 'income' | 'expense'

interface Income {
  id: number
  source: string
  amount: number
  note: string | null
  incomeDate: string
  createdAt: string
}
interface Expense {
  id: number
  category: string
  amount: number
  note: string | null
  expenseDate: string
  createdAt: string
}
type Entry = Income | Expense

interface ListResp<T> {
  list: T[]
  pagination: { total: number }
}

const PRESETS: { label: string; range: () => [Dayjs, Dayjs] }[] = [
  { label: '今天', range: () => [dayjs(), dayjs()] },
  { label: '近7天', range: () => [dayjs().subtract(6, 'day'), dayjs()] },
  { label: '近30天', range: () => [dayjs().subtract(29, 'day'), dayjs()] },
  { label: '本月', range: () => [dayjs().startOf('month'), dayjs()] },
]

const INCOME_QUICK = ['日结营业额', '其他收入']
const EXPENSE_QUICK = ['房租', '水电', '工资', '杂费', '其他']

const isIncome = (e: Entry): e is Income => 'source' in e

export default function LedgerPage() {
  const { message } = App.useApp()
  const [mode, setMode] = useState<Mode>('income')
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => PRESETS[2].range())
  const [rows, setRows] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  const isInc = mode === 'income'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page: 1,
        pageSize: 500,
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
      }
      if (isInc) {
        const data = await api.get<ListResp<Income>>('/incomes', params)
        setRows(data.list)
        setTotal(data.pagination.total)
      } else {
        const data = await api.get<ListResp<Expense>>('/expenses', params)
        setRows(data.list)
        setTotal(data.pagination.total)
      }
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [isInc, range, message])

  useEffect(() => {
    load()
  }, [load])

  const sum = useMemo(() => rows.reduce((s, r) => s + (r.amount ?? 0), 0), [rows])
  const accent = isInc ? T.emerald : T.error

  // ===== 记一笔 =====
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form] = Form.useForm()

  const openCreate = () => {
    form.resetFields()
    form.setFieldsValue({ date: dayjs() })
    setOpen(true)
  }

  const submit = async () => {
    const v = await form.validateFields()
    setBusy(true)
    const date: Dayjs | undefined = v.date
    try {
      if (isInc) {
        await api.post('/incomes', {
          source: (v.name as string).trim(),
          amount: v.amount,
          note: v.note?.trim() || undefined,
          incomeDate: date ? date.format('YYYY-MM-DD') : undefined,
        })
      } else {
        await api.post('/expenses', {
          category: (v.name as string).trim(),
          amount: v.amount,
          note: v.note?.trim() || undefined,
          expenseDate: date ? date.format('YYYY-MM-DD') : undefined,
        })
      }
      message.success('已记一笔')
      setOpen(false)
      load()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (e: Entry) => {
    try {
      await api.delete(`${isInc ? '/incomes' : '/expenses'}/${e.id}`)
      message.success('已删除')
      load()
    } catch (err) {
      message.error((err as Error).message)
    }
  }

  const columns: ColumnsType<Entry> = [
    {
      title: isInc ? '来源' : '类别',
      key: 'name',
      render: (_, r) => <span style={{ fontWeight: 600 }}>{isIncome(r) ? r.source : r.category}</span>,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 130,
      render: (v: number) => <b style={{ color: accent }}>{fmtMoney(v)}</b>,
    },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (v: string | null) => v || <span style={{ color: T.secondary }}>-</span>,
    },
    {
      title: '日期',
      key: 'date',
      width: 130,
      render: (_, r) => dayjs(isIncome(r) ? r.incomeDate : r.expenseDate).format('YYYY-MM-DD'),
    },
    {
      title: '操作',
      key: 'ops',
      width: 80,
      fixed: 'right',
      render: (_, r) => (
        <Popconfirm title="删除这笔记录？" description="删除后不可恢复" onConfirm={() => remove(r)}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  const quick = isInc ? INCOME_QUICK : EXPENSE_QUICK

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 顶部：tab + 日期预设 + 记一笔 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['income', 'expense'] as Mode[]).map((m) => (
            <span
              key={m}
              onClick={() => setMode(m)}
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
              {m === 'income' ? '收入' : '支出'}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
          {PRESETS.map((p) => {
            const r = p.range()
            const active = range[0].isSame(r[0], 'day') && range[1].isSame(r[1], 'day')
            return (
              <span
                key={p.label}
                onClick={() => setRange(r)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: active ? T.surfaceContainerLow : T.surfaceContainer,
                  color: active ? T.primary : T.secondary,
                  border: active ? `1px solid ${T.primary}33` : '1px solid transparent',
                }}
              >
                {p.label}
              </span>
            )
          })}
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
            style={{ borderRadius: 999 }}
          />
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          记一笔
        </Button>
      </div>

      {/* 区间汇总条 */}
      <div
        style={{
          ...cardStyle,
          padding: '12px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          borderColor: `${accent}44`,
        }}
      >
        <Typography.Text>
          {isInc ? '这段时间收入合计 ' : '这段时间支出合计 '}
          <b style={{ color: accent }}>{fmtMoney(sum)}</b>
          <span style={{ color: T.secondary }}>（{total} 笔）</span>
        </Typography.Text>
      </div>

      {/* 列表 */}
      <div style={{ ...cardStyle, padding: '8px 16px 16px', overflow: 'hidden' }}>
        <Table<Entry>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          size="middle"
          locale={{ emptyText: <Empty description={`这段时间还没有${isInc ? '收入' : '支出'}记录`} /> }}
          pagination={{ pageSize: 15, showTotal: (t) => `共 ${t} 笔` }}
          scroll={{ x: 620 }}
        />
      </div>

      {/* 记一笔 Modal */}
      <Modal
        title={isInc ? '记一笔收入' : '记一笔支出'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={busy}
        okText="保存"
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label={isInc ? '来源' : '类别'}
            rules={[{ required: true, message: isInc ? '填写来源' : '填写类别' }]}
          >
            <Input placeholder={isInc ? '如：日结营业额' : '如：房租'} maxLength={40} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '-8px 0 12px' }}>
            {quick.map((q) => (
              <span
                key={q}
                onClick={() => form.setFieldsValue({ name: q })}
                style={{
                  padding: '3px 12px',
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: 'pointer',
                  background: T.surfaceContainer,
                  color: T.secondary,
                }}
              >
                {q}
              </span>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="amount" label="金额" rules={[{ required: true, message: '填写金额' }]}>
              <InputNumber
                min={0.01}
                precision={2}
                prefix="¥"
                placeholder="0.00"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item name="date" label="日期" rules={[{ required: true, message: '选择日期' }]}>
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={200} placeholder="选填" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
