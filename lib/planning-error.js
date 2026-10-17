'use strict';

// Only these messages cross the HTTP boundary. Never forward vendor bodies,
// request headers, credentials, or arbitrary exception messages to the browser.
const MESSAGES = Object.freeze({
  MODEL_KEY_REQUIRED: ['生成新行程需要 DeepSeek Key，请先在设置中填写；也可以直接体验示例。', 'settings'],
  MODEL_AUTH: ['DeepSeek Key 未通过验证，请在设置中检查或更换。', 'settings'],
  MODEL_BALANCE: ['DeepSeek 账户余额不足，请检查账户后重试。', 'settings'],
  MODEL_RATE_LIMIT: ['DeepSeek 当前请求较多，请稍后重试。', 'retry'],
  MODEL_UNAVAILABLE: ['暂时无法连接行程规划服务，请稍后重试；已填写的需求会保留。', 'retry'],
  MODEL_RESPONSE: ['本次规划结果不完整，请重试；当前行程未改变。', 'retry'],
  PLACES_NOT_CONFIGURED: ['地点查询服务尚未配置，暂时不能生成真实路线；可先体验示例。', 'demo'],
  PLACES_UNAVAILABLE: ['地点查询暂时不可用，请稍后重试；当前行程未改变。', 'retry'],
  PLACES_UNMATCHED: ['未找到足够的准确地点，请补充具体景点名称或换一种描述后重试。', 'revise']
});

class PlanningError extends Error {
  constructor(code) { super(MESSAGES[code][0]); this.code = code; this.action = MESSAGES[code][1]; }
}

function modelHttpError(status) {
  return new PlanningError(status === 401 || status === 403 ? 'MODEL_AUTH' : status === 402 ? 'MODEL_BALANCE' : status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_UNAVAILABLE');
}

module.exports = { PlanningError, modelHttpError };
