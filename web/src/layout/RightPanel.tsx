import { Button, Tooltip } from 'antd'
import { DoubleRightOutlined } from '@ant-design/icons'
import ActivityFeed from '../features/activity/ActivityFeed'
import AiChatPanel from '../features/ai/AiChatPanel'
import { useAuth } from '../auth'
import { t } from '../lib/i18n'

// 右栏：最近动态（全员）+ AI 问生意（仅老板；后端 /ai/ask 也是 adminOnly 双保险）
// onCollapse：宽屏时右上角出收起钮（收起后从顶栏铃铛再展开）；Drawer 形态不传（点 mask 即关）
export default function RightPanel({ onCollapse }: { onCollapse?: () => void }) {
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
        position: 'relative',
      }}
    >
      {onCollapse && (
        <Tooltip title={t('收起面板（顶栏铃铛可再展开）', 'Collapse (reopen from the bell icon)')} placement="left">
          <Button
            size="small"
            type="text"
            icon={<DoubleRightOutlined style={{ fontSize: 12 }} />}
            onClick={onCollapse}
            style={{ position: 'absolute', top: 20, right: 14, zIndex: 2, color: '#8f8da0' }}
          />
        </Tooltip>
      )}
      <ActivityFeed />
      {isAdmin && <AiChatPanel />}
    </div>
  )
}
