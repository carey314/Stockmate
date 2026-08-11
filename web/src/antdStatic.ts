import type { MessageInstance } from 'antd/es/message/interface'

// 由 AntdStaticBridge 注入的 message 实例，供非组件代码（axios 拦截器）使用
export const staticHolder: { message: MessageInstance | null } = { message: null }
