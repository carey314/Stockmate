import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 生产挂 qxju.shop/mate/（构建时 VITE_BASE=/mate/）；
// dev 与本地测试脚本沿用 /stockmate/admin/ 不变
export default defineConfig({
  base: process.env.VITE_BASE || '/stockmate/admin/',
  plugins: [react()],
  server: {
    port: 5180,
  },
  build: {
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: 'echarts', test: /node_modules[\\/](echarts|zrender)/ },
            { name: 'antd', test: /node_modules[\\/](antd|@ant-design|rc-)/ },
          ],
        },
      },
    },
  },
})
