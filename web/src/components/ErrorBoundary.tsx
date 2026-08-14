import { Component, type ReactNode } from 'react'
import { Button, Typography } from 'antd'
import { T, cardStyle } from '../theme'
import { t } from '../lib/i18n'

// 页面级白屏保护：任何页面组件抛错，只炸内容区不炸整个应用壳（侧栏/顶栏还在，
// 用户能切去别的页），并给出人话 + 刷新按钮。没有它，一个渲染错误 = 全站白屏。
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    // 打到控制台足矣——Web 端没接自建上报（App 的 /client-logs 面向崩溃，按需再接）
    console.error('[页面渲染出错]', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ ...cardStyle, padding: 48, textAlign: 'center', marginTop: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🧯</div>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {t('这个页面出了点问题', 'Something went wrong on this page')}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
          {t('数据没有丢，刷新一下通常就好；反复出现请联系我们。', 'Your data is safe. A refresh usually fixes it.')}
        </Typography.Text>
        <Button type="primary" onClick={() => location.reload()}>
          {t('刷新页面', 'Reload')}
        </Button>
        <div style={{ marginTop: 18, fontSize: 11, color: T.outlineVariant, wordBreak: 'break-all' }}>
          {String(this.state.error)}
        </div>
      </div>
    )
  }
}
