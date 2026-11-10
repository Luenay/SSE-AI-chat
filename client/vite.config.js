import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 前端只需要知道「/api」这个相对路径，真实后端地址由开发服务器代理。
// 好处：浏览器看到的是同源请求，不需要处理跨域，也不需要把后端地址写死在代码里。
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        // http-proxy 默认逐块转发响应体，不会缓冲整条 SSE 流，
        // 因此模型每吐出一段，浏览器就能立刻收到一段。
      },
    },
  },
});
