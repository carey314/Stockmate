// 极简双语方案：t('中文', 'English') 内联双写。
// 不引 i18next、不建词典 key——这个体量的后台，key 管理的成本远高于双写，
// 且漏翻的地方在代码里一眼可见。语言切换 = localStorage + reload（与主题色同一套路，
// 模块级常量如 SideNav 的 NAV 无需改造成响应式）。
export type Lang = 'zh' | 'en'

export const LANG_KEY = 'sm_lang'

export const LANG: Lang = (() => {
  const saved = localStorage.getItem(LANG_KEY)
  if (saved === 'zh' || saved === 'en') return saved
  // 首次跟随浏览器
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
})()

export const setLang = (lang: Lang) => {
  localStorage.setItem(LANG_KEY, lang)
  location.reload()
}

export const t = (zh: string, en: string) => (LANG === 'zh' ? zh : en)

// dayjs 格式（顶栏日期等）
export const dateFormat = LANG === 'zh' ? 'YYYY年M月D日' : 'MMM D, YYYY'
