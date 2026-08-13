// 文字大小三档：整体缩放（body zoom），不是只放大 antd 字号——
// 项目里大量内联 px 字号，token 方案只影响 antd 组件会放大得东一块西一块；
// zoom 是布局级缩放，老板人群（视力）要的就是"整个界面大一点"。
// 与主题/语言不同：zoom 即时生效，不需要 reload。
export const FONT_KEY = 'sm_fontscale'

export interface FontScale {
  key: string
  name: string
  nameEn: string
  zoom: number
}

export const FONT_SCALES: FontScale[] = [
  { key: 'std', name: '标准', nameEn: 'Default', zoom: 1 },
  { key: 'large', name: '大', nameEn: 'Large', zoom: 1.12 },
  { key: 'xlarge', name: '特大', nameEn: 'X-Large', zoom: 1.25 },
]

export const currentFontScale = (): string => {
  const k = localStorage.getItem(FONT_KEY)
  return FONT_SCALES.some((s) => s.key === k) ? (k as string) : 'std'
}

export const applyFontScale = (key?: string) => {
  const k = key ?? currentFontScale()
  const scale = FONT_SCALES.find((s) => s.key === k) ?? FONT_SCALES[0]
  // zoom 已在 Chrome/Safari/Edge/Firefox126+ 标准化；TS DOM lib 老版本没这个键，绕类型
  ;(document.body.style as unknown as { zoom: string }).zoom = String(scale.zoom)
}

export const setFontScale = (key: string) => {
  localStorage.setItem(FONT_KEY, key)
  applyFontScale(key)
}
