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
import { CheckOutlined } from '@ant-design/icons'
import { Segmented } from 'antd'
import api from '../api/client'
import { useAuth } from '../auth'
import { T, cardStyle, THEME_PRESETS, activeTheme, setThemePreset } from '../theme'
import { LANG, setLang, t } from '../lib/i18n'
import { FONT_SCALES, currentFontScale, setFontScale } from '../lib/fontScale'

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
      message.success(t('店铺设置已保存', 'Store settings saved'))
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
      message.success(
        t(
          `员工「${v.realName}」已创建，把用户名和密码告诉 TA 即可在 App/网页登录`,
          `Staff account "${v.realName}" created. Share the username and password so they can sign in on the app or web.`,
        ),
      )
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
      message.success(
        u.status === 1
          ? t(`已停用 ${u.realName}（TA 的登录立即失效）`, `${u.realName} disabled — their sign-in stops working immediately`)
          : t(`已启用 ${u.realName}`, `${u.realName} enabled`),
      )
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
      message.success(t(`已重置 ${resetTarget.realName} 的密码`, `Password reset for ${resetTarget.realName}`))
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
  const [fontScale, setFontScaleState] = useState(() => currentFontScale())
  const changePwd = async () => {
    const v = await pwdForm.validateFields()
    setPwdBusy(true)
    try {
      await api.put('/auth/password', { oldPassword: v.oldPassword, newPassword: v.newPassword })
      message.success(t('密码已修改，下次登录用新密码', 'Password changed. Use the new one next time you sign in.'))
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
        <Section
          title={t('店铺信息', 'Store info')}
          desc={t(
            '店名用于票据抬头和对账单；主营品类是商品页/开单/盘点的默认筛选',
            'The store name appears on receipts and statements; the main category is the default filter on products, order creation and stocktakes',
          )}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: 12, color: T.secondary, marginBottom: 6 }}>{t('店名', 'Store name')}</div>
              <Input value={shopName} onChange={(e) => setShopName(e.target.value)} style={{ width: 220 }} maxLength={30} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.secondary, marginBottom: 6 }}>{t('主营品类', 'Main category')}</div>
              <Select
                allowClear
                placeholder={t('不设置', 'Not set')}
                value={mainType}
                onChange={(v) => setMainType(v ?? null)}
                options={types.map((t) => ({ value: t.id, label: t.name }))}
                style={{ width: 180 }}
              />
            </div>
            <Button type="primary" loading={savingShop} onClick={saveShop}>
              {t('保存', 'Save')}
            </Button>
          </div>
        </Section>
      )}

      {isAdmin && (
        <Section
          title={t('员工管理', 'Staff')}
          desc={t(
            '员工用自己的账号登录 App 和网页开单、管库存；看不到：利润 / 资金流水 / 员工业绩 / AI 问生意 / 导出，也不能删商品删品类',
            'Staff sign in with their own accounts to create orders and manage stock. They cannot see profit, cash flow, staff performance, Ask AI or exports, and cannot delete products or categories.',
          )}
        >
          <div style={{ marginBottom: 12 }}>
            <Button type="primary" icon={<UserAddOutlined />} onClick={() => setStaffOpen(true)}>
              {t('新建员工账号', 'New staff account')}
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
                title: t('姓名', 'Name'),
                dataIndex: 'realName',
                render: (v, u) => (
                  <span>
                    {v}
                    {u.id === user?.id && (
                      <Tag style={{ marginLeft: 8, borderRadius: 999 }} color="purple">
                        {t('我', 'Me')}
                      </Tag>
                    )}
                  </span>
                ),
              },
              { title: t('登录用户名', 'Username'), dataIndex: 'username', render: (v) => <code>{v}</code> },
              {
                title: t('角色', 'Role'),
                dataIndex: 'role',
                width: 90,
                render: (r) => (
                  <Tag color={r === 'admin' ? 'purple' : 'default'} style={{ borderRadius: 999 }}>
                    {r === 'admin' ? t('老板', 'Owner') : t('员工', 'Staff')}
                  </Tag>
                ),
              },
              {
                title: t('创建时间', 'Created'),
                dataIndex: 'createdAt',
                width: 120,
                render: (v) => dayjs(v).format('YYYY-MM-DD'),
              },
              {
                title: t('启用', 'Active'),
                key: 'status',
                width: 80,
                render: (_, u) =>
                  u.id === user?.id ? (
                    <Switch checked disabled title={t('不能停用自己', 'You cannot disable your own account')} />
                  ) : (
                    <Popconfirm
                      title={
                        u.status === 1
                          ? t(`停用 ${u.realName}？TA 的登录立即失效`, `Disable ${u.realName}? Their sign-in stops working immediately.`)
                          : t(`启用 ${u.realName}？`, `Enable ${u.realName}?`)
                      }
                      onConfirm={() => toggleUser(u)}
                    >
                      <Switch checked={u.status === 1} />
                    </Popconfirm>
                  ),
              },
              {
                title: t('操作', 'Actions'),
                key: 'ops',
                width: 110,
                render: (_, u) => (
                  <Button size="small" type="text" icon={<KeyOutlined />} onClick={() => setResetTarget(u)}>
                    {t('重置密码', 'Reset password')}
                  </Button>
                ),
              },
            ]}
          />
        </Section>
      )}

      {/* 外观与语言：全员可用，只存本机浏览器（localStorage），不影响别的设备/同事 */}
      <Section
        title={t('外观与语言', 'Appearance & Language')}
        desc={t('只影响这台电脑的浏览器，不影响手机 App 和其他同事', 'Saved in this browser only; does not affect the mobile app or teammates')}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 10 }}>
              {t('主题色', 'Theme color')}
            </Typography.Text>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {THEME_PRESETS.map((p) => {
                const active = p.key === activeTheme.key
                return (
                  <div
                    key={p.key}
                    onClick={() => !active && setThemePreset(p.key)}
                    style={{ textAlign: 'center', cursor: active ? 'default' : 'pointer', width: 64 }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        margin: '0 auto',
                        borderRadius: 999,
                        background: `linear-gradient(135deg, ${p.primary}, ${p.primaryContainer})`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                        fontSize: 16,
                        border: active ? `3px solid ${T.onSurface}` : '3px solid transparent',
                        boxShadow: `0 4px 12px ${p.primary}40`,
                      }}
                    >
                      {active && <CheckOutlined />}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.secondary, marginTop: 6 }}>
                      {t(p.name, p.nameEn)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 10 }}>
              {t('文字大小', 'Text size')}
            </Typography.Text>
            <Segmented
              value={fontScale}
              onChange={(v) => {
                setFontScale(v as string)
                setFontScaleState(v as string)
              }}
              options={FONT_SCALES.map((s) => ({ label: t(s.name, s.nameEn), value: s.key }))}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
              {t('整个界面一起放大，立即生效。', 'Scales the whole interface, applies instantly.')}
            </Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 10 }}>
              {t('界面语言', 'Language')}
            </Typography.Text>
            <Segmented
              value={LANG}
              onChange={(v) => v !== LANG && setLang(v as 'zh' | 'en')}
              options={[
                { label: '简体中文', value: 'zh' },
                { label: 'English', value: 'en' },
              ]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
              {t(
                '全部界面均支持中英文；商品、客户等你录入的数据保持原文。',
                'The entire interface supports Chinese and English; your own data (products, customers…) stays as entered.',
              )}
            </Typography.Text>
          </div>
        </div>
      </Section>

      <Section
        title={t('修改我的密码', 'Change my password')}
        desc={t('改完下次登录生效，当前登录不受影响', 'Takes effect at your next sign-in; your current session stays active')}
      >
        <Form form={pwdForm} layout="inline">
          <Form.Item name="oldPassword" rules={[{ required: true, message: t('填旧密码', 'Enter your current password') }]}>
            <Input.Password placeholder={t('旧密码', 'Current password')} style={{ width: 170 }} />
          </Form.Item>
          <Form.Item
            name="newPassword"
            rules={[
              { required: true, message: t('填新密码', 'Enter a new password') },
              { min: 6, message: t('至少 6 位', 'At least 6 characters') },
            ]}
          >
            <Input.Password placeholder={t('新密码（至少6位）', 'New password (6+ characters)')} style={{ width: 190 }} />
          </Form.Item>
          <Button type="primary" loading={pwdBusy} onClick={changePwd}>
            {t('修改密码', 'Change password')}
          </Button>
        </Form>
      </Section>

      {/* 新建员工 */}
      <Modal
        title={t('新建员工账号', 'New staff account')}
        open={staffOpen}
        onCancel={() => setStaffOpen(false)}
        onOk={createStaff}
        confirmLoading={staffBusy}
        okText={t('创建', 'Create')}
      >
        <Form form={staffForm} layout="vertical">
          <Form.Item name="realName" label={t('姓名', 'Name')} rules={[{ required: true, message: t('填姓名', 'Enter a name') }]}>
            <Input placeholder={t('小张', 'e.g. Alex')} maxLength={30} />
          </Form.Item>
          <Form.Item
            name="username"
            label={t('登录用户名', 'Username')}
            rules={[
              { required: true, message: t('填用户名', 'Enter a username') },
              { min: 3, message: t('至少 3 位', 'At least 3 characters') },
              { pattern: /^[a-zA-Z0-9_一-龥]+$/, message: t('只能是中英文、数字、下划线', 'Letters, Chinese characters, digits and underscores only') },
            ]}
          >
            <Input placeholder={t('TA 登录用的账号，如 xiaozhang', 'The account they sign in with, e.g. alexlee')} maxLength={20} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t('初始密码', 'Initial password')}
            rules={[
              { required: true, message: t('填密码', 'Enter a password') },
              { min: 6, message: t('至少 6 位', 'At least 6 characters') },
            ]}
          >
            <Input.Password placeholder={t('至少 6 位，告诉员工后 TA 可自行修改', 'At least 6 characters; they can change it after signing in')} />
          </Form.Item>
          <Form.Item name="phone" label={t('手机（选填）', 'Phone (optional)')}>
            <Input maxLength={20} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 重置密码 */}
      <Modal
        title={resetTarget ? t(`重置 ${resetTarget.realName} 的密码`, `Reset password for ${resetTarget.realName}`) : ''}
        open={!!resetTarget}
        onCancel={() => setResetTarget(null)}
        onOk={resetPassword}
        confirmLoading={resetBusy}
        okText={t('重置', 'Reset')}
      >
        <Form form={resetForm} layout="vertical">
          <Form.Item
            name="password"
            label={t('新密码', 'New password')}
            rules={[
              { required: true, message: t('填新密码', 'Enter a new password') },
              { min: 6, message: t('至少 6 位', 'At least 6 characters') },
            ]}
          >
            <Input.Password placeholder={t('至少 6 位', 'At least 6 characters')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
