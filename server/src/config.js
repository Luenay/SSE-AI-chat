import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// 用「相对本文件」的路径定位 server/.env。
// 这样无论在项目根目录还是 server/ 目录里执行 npm 命令，读到的都是同一份配置，
// 避免初学者最常踩的「明明配了 .env 却读不到」的坑。
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
dotenv.config({ path: envPath });

// 只在这里读取 process.env，其他模块一律 import config，方便统一改默认值。
const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
const rawBaseUrl = process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const requestedModel = (process.env.DASHSCOPE_MODEL || 'qwen-plus').trim();

// 页面上可切换的模型列表，逗号分隔。
// 百炼控制台「开通 / 免费额度」只是给账号授权，不会自动同步到本应用，
// 想让某个模型出现在下拉框里，必须在这里显式列出。
const configuredModels = (process.env.DASHSCOPE_MODELS || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const models = configuredModels.length > 0 ? configuredModels : [requestedModel];
// 默认模型一定要在候选列表里，保证 health 返回的 model 和下拉框对得上
const model = models.includes(requestedModel) ? requestedModel : models[0];

export const config = Object.freeze({
  port: Number(process.env.PORT) || 3001,
  apiKey,
  baseUrl: rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl,
  model,
  models,
  // 没填密钥就自动进入模拟模式，零配置也能跑通全链路
  isMock: apiKey.length === 0,
  maxQuestionLength: 4000,
  upstreamTimeoutMs: 90_000,
});
