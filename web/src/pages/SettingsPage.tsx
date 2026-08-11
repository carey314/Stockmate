import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import { KeyOutlined, UserAddOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useState } from 'react'
import dayjs from 'dayjs'
import api from '../api/client'
import { useAuth } from '../auth'
import { T, cardStyle } from '../theme'

interface UserRow {
  id: number
  username: string
  realName: string
  phone: string | null
  role: 'admin' | 'staff'
  status: number
  createdAt: string
}
interface ProductType {
  id: number
  name: string
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, padding: 24 }}>
      <Typography.Text strong style={{ fontSize: 17 }}>
        {title}
      </Typography.Text>
      {desc && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
          {desc}
        </Typography.Paragraph>
      )}
      <div style={{ marginTop: 16 }}>{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const { user, profile, refreshProfile } = useAuth()
  const { message } = App.useApp()
  const isAdmin = user?.role === 'admin'

  // ===== 店铺信息（仅老板）=====
  const [shopName, setShopName] = useState('')
  const [types, setTypes] = useState<ProductType[]>([])
  const [mainType, setMainType] = useState<number | null>(null)
  const [savingShop, setSavingShop] = useState(false)

  useEffect(() => {
    setShopName(profile?.shopName ?? '')
    setMainType(profile?.mainTypeId ?? null)
  }, [profile])

  useEffect(() => {
    if (!isAdmin) return
    api
      .get<ProductType[] | { list: ProductType[] }>('/product-types')
      .then((d) => setTypes(Array.isArray(d) ? d : d.list))
      .catch(() => {})
  }, [isAdmin])

  const saveShop = async () => {
    setSavingShop(true)
    try {
      if (shopName.trim() && shopName.trim() !== profile?.shopName) {
        await api.put('/settings/shop-name', { shopName: shopName.trim() })
      }
      if (mainType !== (profile?.mainTypeId ?? null)) {
        await api.put('/settings/main-type', { productTypeId: mainType })
      }
      await refreshProfile()
      message.success('店铺设置已保存')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setSavingShop(false)
    }
  }

  // ===== 员工管理（仅老板）=====
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const loadUsers = useCallback(() => {
    api.get<UserRow[]>('/system/users').then(setUsers).catch((e) => message.error((e as Error).message))
  }, [message])
  useEffect(() => {
    if (isAdmin) loadUsers()
  }, [isAdmin, loadUsers])

  const [staffOpen, setStaffOpen] = useState(false)
  const [staffBusy, setStaffBusy] = useState(false)
  const [staffForm] = Form.useForm()
  const createStaff = async () => {
    const v = await staffForm.validateFields()
    setStaffBusy(true)
    try {
      await api.post('/system/users', {
        username: v.username.trim(),
        password: v.password,
        realName: v.realName.trim(),
        phone: v.phone?.trim() || null,
      })
      message.success(`员工「${v.realName}」已创建，把用户名和密码告诉 TA 即可在 App/网页登录`)
      setStaffOpen(false)
      staffForm.resetFields()
      loadUsers()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setStaffBusy(false)
    }
  }

  const toggleUser = async (u: UserRow) => {
    try {
      await api.put(`/system/users/${u.id}/toggle`)
      message.success(u.status === 1 ? `已停用 ${u.realName}（TA 的登录立即失效）` : `已启用 ${u.realName}`)
      loadUsers()
    } catch (e) {
      message.error((e as Error).message)
    }
  }

  const [resetTarget, setResetTarget] = useState<UserRow | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetForm] = Form.useForm()
  const resetPassword = async () => {
    if (!resetTarget) return
    const v = await resetForm.validateFields()
    setResetBusy(true)
    try {
      await api.put(`/system/users/${resetTarget.id}/password`, { password: v.password })
      message.success(`已重置 ${resetTarget.realName} 的密码`)
      setResetTarget(null)
      resetForm.resetFields()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  // ===== 修改自己密码（所有人）=====
  const [pwdBusy, setPwdBusy] = useState(false)
  const [pwdForm] = Form.useForm()
  const changePwd = async () => {
    const v = await pwdForm.validateFields()
    setPwdBusy(true)
    try {
      await api.put('/auth/password', { oldPassword: v.oldPassword, newPassword: v.newPassword })
      message.success('密码已修改，下次登录用新密码')
      pwdForm.resetFields()
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setPwdBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      {isAdmin && (
        <Section title="店铺信息" desc="店名用于票据抬头和对账单；主营品类是商品页/开单/盘点的默认筛选">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 12, color: T.secondary, marginBottom: 6 }}>店名</div>
              <Input value={shopName} onChange={(e) => setShopName(e.target.value)} style={{ width: 220 }} maxLength={30} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.secondary, marginBottom: 6 }}>主营品类</div>
              <Select
                allowClear
                placeholder="不设置"
                value={mainType}
                onChange={(v) => setMainType(v ?? null)}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
                style={{ width: 180 }}
              />
            </div>
            <Button type="primary" loading={savingShop} onClick={saveShop}>
              保存
            </Button>
          </div>
        </Section>
      )}

      {isAdmin && (
        <Section
          title="员工管理"
          desc="员工用自己的账号登录 App 和网页开单、管库存；看不到：利润 / 资金流水 / 员工业绩 / AI 问生意 / 导出，也不能删商品删品类"
        >
          <div style={{ marginBottom: 12 }}>
            <Button type="primary" icon={<UserAddOutlined />} onClick={() => setStaffOpen(true)}>
              新建员工账号
            </Button>
          </div>
          <Table<UserRow>
            rowKey="id"
            dataSource={users ?? []}
            loading={users === null}
            size="middle"
            pagination={false}
            columns={[
              {
                title: '姓名',
                dataIndex: 'realName',
                render: (v, u) => (
                  <span>
                    {v}
                    {u.id === user?.id && (
                      <Tag style={{ marginLeft: 8, borderRadius: 999 }} color="purple">
                        我
                      </Tag>
                    )}
                  </span>
                ),
              },
              { title: '登录用户名', dataIndex: 'username', render: (v) => <code>{v}</code> },
              {
                title: '角色',
                dataIndex: 'role',
                width: 90,
                render: (r) => (
                  <Tag color={r === 'admin' ? 'purple' : 'default'} style={{ borderRadius: 999 }}>
                    {r === 'admin' ? '老板' : '员工'}
                  </Tag>
                ),
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                width: 120,
                render: (v) => dayjs(v).format('YYYY-MM-DD'),
              },
              {
                title: '启用',
                key: 'status',
                width: 80,
                render: (_, u) =>
                  u.id === user?.id ? (
                    <Switch checked disabled title="不能停用自己" />
                  ) : (
                    <Popconfirm
                      title={u.status === 1 ? `停用 ${u.realName}？TA 的登录立即失效` : `启用 ${u.realName}？`}
                      onConfirm={() => toggleUser(u)}
                    >
                      <Switch checked={u.status === 1} />
                    </Popconfirm>
                  ),
              },
              {
                title: '操作',
                key: 'ops',
                width: 110,
                render: (_, u) => (
                  <Button size="small" type="text" icon={<KeyOutlined />} onClick={() => setResetTarget(u)}>
                    重置密码
                  </Button>
                ),
              },
            ]}
          />
        </Section>
      )}

      <Section title="修改我的密码" desc="改完下次登录生效，当前登录不受影响">
        <Form form={pwdForm} layout="inline">
          <Form.Item name="oldPassword" rules={[{ required: true, message: '填旧密码' }]}>
            <Input.Password placeholder="旧密码" style={{ width: 170 }} />
          </Form.Item>
          <Form.Item
            name="newPassword"
            rules={[
              { required: true, message: '填新密码' },
              { min: 6, message: '至少 6 位' },
            ]}
          >
            <Input.Password placeholder="新密码（至少6位）" style={{ width: 190 }} />
          </Form.Item>
          <Button type="primary" loading={pwdBusy} onClick={changePwd}>
            修改密码
          </Button>
        </Form>
      </Section>

      {/* 新建员工 */}
      <Modal
        title="新建员工账号"
        open={staffOpen}
        onCancel={() => setStaffOpen(false)}
        onOk={createStaff}
        confirmLoading={staffBusy}
        okText="创建"
      >
        <Form form={staffForm} layout="vertical">
          <Form.Item name="realName" label="姓名" rules={[{ required: true, message: '填姓名' }]}>
            <Input placeholder="小张" maxLength={30} />
          </Form.Item>
          <Form.Item
            name="username"
            label="登录用户名"
            rules={[
              { required: true, message: '填用户名' },
              { min: 3, message: '至少 3 位' },
              { pattern: /^[a-zA-Z0-9_一-龥]+$/, message: '只能是中英文、数字、下划线' },
            ]}
          >
            <Input placeholder="TA 登录用的账号，如 xiaozhang" maxLength={20} />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: '填密码' },
              { min: 6, message: '至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位，告诉员工后 TA 可自行修改" />
          </Form.Item>
          <Form.Item name="phone" label="手机（选填）">
            <Input maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={resetTarget ? `重置 ${resetTarget.realName} 的密码` : ''}
        open={!!resetTarget}
        onCancel={() => setResetTarget(null)}
        onOk={resetPassword}
        confirmLoading={resetBusy}
        okText="重置"
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '填新密码' },
              { min: 6, message: '至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
