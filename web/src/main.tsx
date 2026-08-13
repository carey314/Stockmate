import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import enUS from 'antd/locale/en_US'
import { staticHolder } from './antdStatic'
import { antdTheme } from './theme'
import { LANG } from './lib/i18n'
import { applyFontScale } from './lib/fontScale'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import App from './App'
import { AuthProvider } from './auth'
import './index.css'

dayjs.locale(LANG === 'zh' ? 'zh-cn' : 'en')
applyFontScale() // 启动即应用文字大小偏好（body zoom，即时生效无需 reload）

// 把 AntApp 上下文里的 message 实例交给非组件代码（axios 拦截器）用
function AntdStaticBridge() {
  const { message } = AntApp.useApp()
  staticHolder.message = message
  return null
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider locale={LANG === 'zh' ? zhCN : enUS} theme={antdTheme}>
      <AntApp>
        <AntdStaticBridge />
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
)
