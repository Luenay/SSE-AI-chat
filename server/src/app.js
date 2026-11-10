import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import chatRouter from './routes/chat.js';

const app = express();

app.disable('x-powered-by');

// 几个低风险的安全响应头，不影响本地开发。
// 生产部署时还应在网关层补充 CSP 与 HTTPS（HSTS），见 README 的「上线前清单」。
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

// 正常浏览走 Vite 代理（同源，不受 CORS 限制）；这里只放行本地前端直连的场景。
// 若部署到公网，请把 origin 换成自己的域名白名单。
app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '32kb' }));

// 健康检查：告诉前端当前模式、默认模型，以及下拉框里可以选哪些模型
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mode: config.isMock ? 'mock' : 'real',
    model: config.model,
    models: config.models,
  });
});

app.use('/api', chatRouter);

app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// Express 的 JSON 解析失败等错误统一兜底成 JSON，而不是返回一页 HTML
app.use((err, req, res, next) => {
  console.error('[server] 请求处理失败:', err?.message);
  if (res.headersSent) return next(err);
  res.status(400).json({ error: '请求体不是合法的 JSON' });
});

app.listen(config.port, () => {
  console.log(`[server] 已启动：http://127.0.0.1:${config.port}`);
  console.log(
    `[server] 运行模式：${config.isMock ? 'Mock 模拟（未配置 DASHSCOPE_API_KEY）' : `真实模型 ${config.model}`}`,
  );
  console.log(`[server] 可选模型：${config.models.join(', ')}`);
});
