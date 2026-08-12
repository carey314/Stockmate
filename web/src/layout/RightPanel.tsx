import ActivityFeed from '../features/activity/ActivityFeed'
import AiChatPanel from '../features/ai/AiChatPanel'
import { useAuth } from '../auth'

// 右栏：最近动态（全员）+ AI 问生意（仅老板；后端 /ai/ask 也是 adminOnly 双保险）。
// 收起/展开的把手在 AdminLayout（贴面板左缘）——别在这里加浮动按钮，会和动态区刷新钮重叠。
export default function RightPanel() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 20px 16px',
        gap: 14,
        overflow: 'hidden',
      }}
    >
      <ActivityFeed />
      {isAdmin && <AiChatPanel />}
    </div>
  )
}
