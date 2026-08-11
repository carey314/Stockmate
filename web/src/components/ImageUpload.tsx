import { App, Upload } from 'antd'
import { LoadingOutlined, PlusOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { UploadProps } from 'antd'
import api, { assetUrl } from '../api/client'

// 商品/规格图上传：走后端 POST /upload（字段名 file）→ {url:'/uploads/xxx'}，回调完整可访问 url 的相对路径
export default function ImageUpload({ value, onChange }: { value?: string | null; onChange?: (url: string | null) => void }) {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)

  const customRequest: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file as File)
      const data = await api.post<{ url: string }>('/upload', fd)
      onChange?.(data.url)
      onSuccess?.(data)
    } catch (e) {
      message.error((e as Error).message)
      onError?.(e as Error)
    } finally {
      setLoading(false)
    }
  }

  const src = assetUrl(value)

  return (
    <Upload
      listType="picture-card"
      showUploadList={false}
      accept="image/jpeg,image/png,image/webp,image/heic"
      customRequest={customRequest}
      beforeUpload={(f) => {
        if (f.size > 8 * 1024 * 1024) {
          message.error('图片不能超过 8MB')
          return Upload.LIST_IGNORE
        }
        return true
      }}
    >
      {src ? (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <img src={src} alt="商品图" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
        </div>
      ) : (
        <div style={{ color: '#8c8c8c' }}>
          {loading ? <LoadingOutlined /> : <PlusOutlined />}
          <div style={{ marginTop: 4, fontSize: 12 }}>{loading ? '上传中' : '上传图'}</div>
        </div>
      )}
    </Upload>
  )
}
