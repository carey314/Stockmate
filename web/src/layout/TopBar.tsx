import { App, Avatar, Button, Dropdown, Tag } from 'antd'
import {
  BellOutlined,
  CalendarOutlined,
  DownloadOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import dayjs from 'dayjs'
import api from '../api/client'
import { useAuth } from '../auth'
import { T } from '../theme'
import { dateFormat, t } from '../lib/i18n'

export default function TopBar({
  title,
  onOpenPanel,
  onLogout,
}: {
  title: string
  onOpenPanel?: () => void // 窄屏时打开右栏 Drawer
  onLogout: () => void
}) {
  const { user, profile } = useAuth()
  const { message } = App.useApp()
  const isAdmin = user?.role === 'admin'
  const [exporting, setExporting] = useState(false)

  // 诚实承诺：数据永远是用户的，随时全量带走（GET /export/all，仅老板）
  const onExport = async () => {
    setExporting(true)
    try {
      const data = await api.get('/export/all')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${t('智存全量导出', 'stockmate_export')}_${dayjs().format('YYYYMMDD_HHmm')}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      message.success(t('已导出全部数据（JSON）', 'All data exported (JSON)'))
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <header
      style={{
        height: T.topBarHeight,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        background: 'rgba(249, 249, 255, 0.8)',
        backdropFilter: 'blur(24px)',
        zIndex: 10,
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: T.onSurface,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.95)',
            border: '1px solid rgba(199, 196, 215, 0.5)',
            fontSize: 13,
            fontWeight: 600,
            color: T.onSurfaceVariant,
            boxShadow: T.cardShadow,
          }}
        >
          <CalendarOutlined style={{ color: T.secondary }} />
          {dayjs().format(dateFormat)}
        </div>
        {onOpenPanel && (
          <Button
            shape="circle"
            icon={<BellOutlined />}
            onClick={onOpenPanel}
            title={t('动态与 AI 助手', 'Activity & AI assistant')}
          />
        )}
        {isAdmin && (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            onClick={onExport}
            style={{ fontWeight: 600 }}
          >
            {t('导出数据', 'Export')}
          </Button>
        )}
        <Dropdown
          menu={{
            items: [{ key: 'logout', icon: <LogoutOutlined />, label: t('退出登录', 'Sign out'), onClick: onLogout }],
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
              background: '#fff',
              border: '1px solid rgba(199, 196, 215, 0.5)',
              borderRadius: 999,
              padding: '5px 12px 5px 6px',
              boxShadow: T.cardShadow,
            }}
          >
            <Avatar size={30} style={{ background: T.primary }} icon={<UserOutlined />} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{profile?.shopName || user?.realName}</span>
            <Tag
              color={isAdmin ? 'purple' : 'default'}
              style={{ marginInlineEnd: 0, borderRadius: 999, fontSize: 11 }}
            >
              {isAdmin ? t('老板', 'Owner') : t('员工', 'Staff')}
            </Tag>
          </div>
        </Dropdown>
      </div>
    </header>
  )
}
