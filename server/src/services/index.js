import { config } from '../config.js';
import { streamAnswer as fromDashScope } from './llm.js';
import { streamAnswer as fromMock } from './mockStream.js';

/**
 * 策略选择只发生在这一处。
 * 路由层永远只看到 streamAnswer(question, signal) 这一个契约，
 * 将来接入别的模型厂商，只需新增一个实现文件并修改这一行。
 */
export const streamAnswer = config.isMock ? fromMock : fromDashScope;
