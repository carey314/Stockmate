// 本机存储 key 的唯一清单（新增 key 必须登记在这，别再散落魔法字符串）。
//
// 退出登录/401 踢出时的清理策略（auth.tsx logout）：
//   清 —— token / user（凭证与身份）/ sessionStorage 中全部聊天分区
//   登录换号、多标签 token 变化同样清聊天，并使内存权益及旧请求失效。
//   留 —— 主题色 / 语言 / 字号 / 面板偏好（外观是"这台电脑"的偏好，换账号登录不该重置）
//
// token 放 localStorage 是刻意取舍：httpOnly cookie 需要后端会话改造且跨端（App 用
// Bearer）不统一；XSS 防线靠 React 默认转义 + 不用 dangerouslySetInnerHTML。
export const LS = {
  draftPrefix: 'sm_draft:', // 店铺:账号:页面；保留草稿及待确认ID，禁止跨身份读取
  platformToken: 'sm_platform_token', // 独立平台身份，禁止商家JWT混用
  token: 'sm_token', // JWT（登出/401 清）
  user: 'sm_user', // 登录用户快照（登出/401 清）
  theme: 'sm_theme', // 主题色 key（theme.ts）
  lang: 'sm_lang', // 界面语言 zh|en（lib/i18n.ts）
  fontScale: 'sm_fontscale', // 文字大小档（lib/fontScale.ts）
  panelCollapsed: 'sm_panel_collapsed', // 右栏收起（AdminLayout）
  panelRatio: 'sm_panel_ratio', // 右栏动态/AI 高度比（RightPanel）
} as const

export const SS = {
  legacyChat: 'sm_ai_chat', // 旧版没有身份信息，直接删除，禁止迁移到任何账号
  chatPrefix: 'sm_ai_chat:', // 后接 storeId（未知时 account）:userId；仅在当前登录会话恢复
} as const
