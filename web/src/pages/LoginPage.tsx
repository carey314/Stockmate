import { useState } from 'react'
import { App, Button, Form, Input, Typography } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { T, primaryRgba } from '../theme'
import { t } from '../lib/i18n'
import { useMediaQuery } from '../lib/useMediaQuery'

// 登录页：桌面左右分栏（左=品牌价值面，右=表单），<900px 回落单卡居中。
// 左面卖点文案与提审文案口径一致（docs/appstore-listing.md），不许吹没有的功能。
const SELLING_POINTS: [string, string, string][] = [
  ['✨', '30 秒配成自己行业', 'AI 帮你把品类、字段、规格都配好'],
  ['🎙️', '口述记账，一句话成单', '"老王拿了两件泸州老窖收了微信"'],
  ['📊', '报表、欠款、对账单', '一应俱全，打印给客户看也体面'],
]

export default function LoginPage() {
  const { login } = useAuth()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const wide = useMediaQuery('(min-width: 900px)')

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

  const logo = (size: number, fontSize: number) => (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `linear-gradient(135deg, ${T.primary}, ${T.primaryContainer})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize,
        fontWeight: 700,
        boxShadow: `0 8px 24px ${primaryRgba(0.35)}`,
        flexShrink: 0,
      }}
    >
      智
    </div>
  )

  const form = (
    <Form onFinish={onFinish} size="large" requiredMark={false}>
      <Form.Item name="username" rules={[{ required: true, message: t('请输入用户名', 'Enter username') }]}>
        <Input
          prefix={<UserOutlined style={{ color: T.secondary }} />}
          placeholder={t('用户名（与手机 App 同账号）', 'Username (same as mobile app)')}
          autoFocus
        />
      </Form.Item>
      <Form.Item name="password" rules={[{ required: true, message: t('请输入密码', 'Enter password') }]}>
        <Input.Password
          prefix={<LockOutlined style={{ color: T.secondary }} />}
          placeholder={t('密码', 'Password')}
        />
      </Form.Item>
      <Form.Item style={{ marginBottom: 8 }}>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={loading}
          style={{ borderRadius: 999, height: 46, fontWeight: 600, boxShadow: `0 6px 18px ${primaryRgba(0.3)}` }}
        >
          {t('登 录', 'Sign in')}
        </Button>
      </Form.Item>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('账号与手机 App 通用，暂不支持在网页注册。', 'Accounts are shared with the mobile app. Sign-up is app-only for now.')}
      </Typography.Text>
    </Form>
  )

  // 工信部要求备案号在首页底部显著位置并链接查询系统；号变更全局搜「鲁ICP备」
  const icp = (color: string) => (
    <div style={{ textAlign: 'center', marginTop: 20 }}>
      <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer" style={{ fontSize: 12, color }}>
        鲁ICP备2026014341号-1
      </a>
    </div>
  )

  if (!wide) {
    // 窄屏：单卡居中（保持原形态）
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(160deg, #f9f9ff 0%, #e7eeff 60%, #d8e3fb 100%)',
          padding: 16,
        }}
      >
        <div
          className="fade-up"
          style={{
            width: 'min(400px, 92vw)',
            background: '#fff',
            borderRadius: 24,
            boxShadow: `0 12px 40px ${primaryRgba(0.12)}`,
            padding: '40px 36px',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>{logo(56, 26)}</div>
            <Typography.Title level={3} style={{ margin: 0, fontWeight: 700 }}>
              {t('智存管理后台', 'StockMate Admin')}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t('StockMate · 老板在电脑上把账管明白', 'Run your books clearly, on a real screen')}
            </Typography.Text>
          </div>
          {form}
          {icp('#9b99ab')}
        </div>
      </div>
    )
  }

  // 桌面：左品牌面 + 右表单
  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: T.surface }}>
      {/* 左：品牌价值面 */}
      <div
        style={{
          flex: 1.1,
          background: `linear-gradient(150deg, ${T.primary} 0%, ${T.primaryContainer} 70%, ${T.primaryFixed} 160%)`,
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 'min(7vw, 96px)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 装饰光斑 */}
        <div
          style={{
            position: 'absolute',
            width: 520,
            height: 520,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.14), transparent 65%)',
            top: -140,
            right: -140,
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            width: 380,
            height: 380,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.08), transparent 65%)',
            bottom: -120,
            left: -80,
            pointerEvents: 'none',
          }}
        />
        <div className="fade-up" style={{ position: 'relative', maxWidth: 460 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 36 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                background: 'rgba(255,255,255,0.16)',
                border: '1px solid rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 700,
              }}
            >
              智
            </div>
            <div>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '0.01em' }}>
                {t('智存 StockMate', 'StockMate')}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{t('AI 原生进销存', 'AI-native inventory')}</div>
            </div>
          </div>
          <div style={{ fontSize: 'min(2.6vw, 34px)', fontWeight: 800, lineHeight: 1.35, marginBottom: 14 }}>
            {t('小店的账，', 'Your shop’s books,')}
            <br />
            {t('一句话就记明白', 'kept clear in one sentence')}
          </div>
          <div style={{ fontSize: 14.5, opacity: 0.82, marginBottom: 44 }}>
            {t('手机 App 开单收钱，电脑后台管货看账——同一个账号。', 'Sell on the phone, manage on the desktop — one account.')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {SELLING_POINTS.map(([emoji, title, desc], i) => (
              <div key={i} className="fade-up" style={{ display: 'flex', gap: 14, animationDelay: `${120 + i * 90}ms` }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.13)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  {emoji}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
                  <div style={{ fontSize: 12.5, opacity: 0.72, marginTop: 2 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 48, fontSize: 12, opacity: 0.6 }}>
            {t('数据永远是你的：随时全量导出带走，永久免费。', 'Your data is always yours — export everything, free forever.')}
          </div>
        </div>
      </div>

      {/* 右：表单 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 32,
          background: `linear-gradient(160deg, #ffffff 0%, ${T.surface} 100%)`,
        }}
      >
        <div className="fade-up" style={{ width: 'min(380px, 90%)', animationDelay: '80ms' }}>
          <Typography.Title level={3} style={{ margin: '0 0 4px', fontWeight: 800 }}>
            {t('欢迎回来', 'Welcome back')}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 28 }}>
            {t('登录智存管理后台', 'Sign in to StockMate Admin')}
          </Typography.Text>
          {form}
          {icp(T.outlineVariant)}
        </div>
      </div>
    </div>
  )
}
