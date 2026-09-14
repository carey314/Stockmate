import {
  App,
  Button,
  Input,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
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

  const [fontScale, setFontScaleState] = useState(() => currentFontScale())

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
          <Typography.Paragraph type="secondary">
            {t(
              '添加员工和重置员工密码，请在智存 App「我的 → 员工管理」中操作。网页可查看员工并启用或停用账号。',
              'Add staff and reset staff passwords in the Stockmate app under Me → Staff. You can view, enable and disable staff accounts here.',
            )}
          </Typography.Paragraph>
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
        title={t('账号与安全', 'Account & security')}
        desc={t(
          '账号注册、密码设置或找回、手机号绑定统一在智存 App 操作。',
          'Manage registration, passwords, recovery and verified phone binding in the app.',
        )}
      >
        <Typography.Paragraph>
          {t(
            '打开智存 App「我的 → 账号与安全」，按当前账号可用的验证方式设置或修改密码、管理手机号绑定。',
            'Open Me → Account & security in the app. Use the verification methods available for your account to set or change your password and manage your verified phone.',
          )}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {t(
            'Apple 或短信登录且尚未设置密码的账号，请使用 App 内对应的身份验证入口，无需在网页提供原密码。',
            'If you sign in with Apple or SMS and have not set a password, use the appropriate verification option in the app. No current password is required on this page.',
          )}
        </Typography.Paragraph>
        {!isAdmin && (
          <Typography.Paragraph type="secondary">
            {t(
              '员工忘记密码时，请联系店主在 App「我的 → 员工管理」中重置。',
              'If you forget your staff password, ask the store owner to reset it under Me → Staff in the app.',
            )}
          </Typography.Paragraph>
        )}
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t(
            '修改或重置密码会使旧登录会话失效，包括当前网页登录；完成后请重新登录。',
            'Changing or resetting a password invalidates existing sessions, including the current web session. Sign in again afterward.',
          )}
        </Typography.Paragraph>
      </Section>
    </div>
  )
}
