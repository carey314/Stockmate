import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 将来挂 nginx qxju.shop/stockmate/admin/ 子路径
export default defineConfig({
  base: '/stockmate/admin/',
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
