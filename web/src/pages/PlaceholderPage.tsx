import { Empty } from 'antd'

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <Empty
      style={{ paddingTop: 120 }}
      description={`「${title}」开发中，下一个模块就是它`}
    />
  )
}
