import { useState } from 'react'
import { App, Button, Card, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { T, primaryRgba } from '../theme'
import { t } from '../lib/i18n'

export default function LoginPage() {
  const { login } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.username.trim(), values.password)
      const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/'
      navigate(from, { replace: true })
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(160deg, #f9f9ff 0%, #e7eeff 60%, #d8e3fb 100%)',
      }}
    >
      <Card
        style={{
          width: 400,
          borderRadius: 24,
          boxShadow: `0 12px 40px ${primaryRgba(0.12)}`,
        }}
        styles={{ body: { padding: '40px 36px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 12px',
              borderRadius: 16,
              background: `linear-gradient(135deg, ${T.primary}, ${T.primaryContainer})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            智
          </div>
          <Typography.Title level={3} style={{ margin: 0, fontWeight: 700 }}>
            {t('智存管理后台', 'StockMate Admin')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t('StockMate · 老板在电脑上把账管明白', 'Run your books clearly, on a real screen')}
          </Typography.Text>
        </div>
        <Form onFinish={onFinish} size="large" requiredMark={false}>
          <Form.Item name="username" rules={[{ required: true, message: t('请输入用户名', 'Enter username') }]}>
            <Input
              prefix={<UserOutlined />}
              placeholder={t('用户名（与手机 App 同账号）', 'Username (same as mobile app)')}
              autoFocus
            />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: t('请输入密码', 'Enter password') }]}>
            <Input.Password prefix={<LockOutlined />} placeholder={t('密码', 'Password')} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" block loading={loading} style={{ borderRadius: 999 }}>
              {t('登 录', 'Sign in')}
            </Button>
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('账号与手机 App 通用，暂不支持在网页注册。', 'Accounts are shared with the mobile app. Sign-up is app-only for now.')}
          </Typography.Text>
        </Form>
      </Card>
    </div>
  )
}
