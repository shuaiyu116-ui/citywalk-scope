'use strict';
const { scope } = require('./agent-scope');
globalThis.crypto ||= require('node:crypto').webcrypto;
const LIMITS = Object.freeze({ rounds: 2, toolCalls: 40, networkCalls: 48, modelCalls: 10, timeoutMs: 180000 });
const clone = value => structuredClone(value);
const modules = Promise.all([import('../public/itinerary-editor.mjs'), import('../public/schedule.mjs'), import('../public/transport.mjs')]);
const metrics = route => {
  const checks = route.days.flatMap(d => d.schedule?.checks || []);
  return { conflicts: checks.filter(c => c.status === 'conflict').length, unknowns: checks.filter(c => c.status === 'unknown').length, stops: route.stops.length, unknownLegs: route.legs.filter(l => l.status !== 'routed').length };
};
const coverageNotice = route => {
  const empty = route.days.filter(day => !day.stopIds.length).map(day => day.index);
  if (empty.length) return `第 ${empty.join('、')} 天还没有安排地点，需要继续补充。`;
  return route.days.length > 1 && route.stops.length < route.days.length * 2 ? `目前安排 ${route.stops.length} 个地点，作为 ${route.days.length} 天行程的起步建议，可继续补充每天的安排。` : '';
};
function createRun(signal, emit, limits) {
  const started = Date.now();
  const run = { signal, limits, trace: [], modelReports: 0, usage: { rounds: 0, toolCalls: 0, networkCalls: 0, modelCalls: 0, promptTokens: 0, completionTokens: 0, tokenUsageComplete: true } };
  run.check = () => { if (signal.aborted) throw Object.assign(new Error('cancelled'), { code: 'AGENT_CANCELLED' }); };
  run.event = (tool, status, message, extra = {}) => {
    const event = { type: 'progress', seq: run.trace.length + 1, tool, status, message, elapsedMs: Date.now() - started, usage: { ...run.usage }, ...extra };
    run.trace.push(event); emit(event);
  };
  run.call = async (tool, message, fn, { model = false } = {}) => {
    run.check();
    if (run.usage.toolCalls >= limits.toolCalls || (model && run.usage.modelCalls >= limits.modelCalls)) throw Object.assign(new Error('budget'), { code: 'AGENT_LIMIT' });
    run.usage.toolCalls++; if (model) run.usage.modelCalls++;
    run.event(tool, 'started', message);
    try {
      const result = await fn(); run.check();
      run.event(tool, 'completed', `${message}：完成`); return result;
    } catch (error) { run.event(tool, 'failed', `${message}：未完成，保留已有版本`); throw error; }
  };
  return run;
}

async function runAgent({ seed, transport, decide, execute, signal: parentSignal, emit = () => {}, limits: overrides = {} }) {
  // Overrides are only for trusted local tests, never from HTTP input.
  const limits = { ...LIMITS, ...overrides }, controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  if (parentSignal?.aborted) cancel(); else parentSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, limits.timeoutMs);
  const run = createRun(controller.signal, emit, limits);
  let removeAbort;
  const aborted = new Promise((_, reject) => {
    removeAbort = () => reject(Object.assign(new Error(timedOut ? 'timeout' : 'cancelled'), { code: timedOut ? 'AGENT_TIMEOUT' : 'AGENT_CANCELLED' }));
    controller.signal.addEventListener('abort', removeAbort, { once: true });
    if (controller.signal.aborted) removeAbort();
  });
  const work = scope.run(run, async () => {
    const [, { applySchedule }, { transportRequest, transportFingerprint, mergeTransport }] = await modules;
    run.check();
    const calculate = async route => {
      const notices = [];
      const pending = route.legs.filter(l => !route.stops.find(s=>s.id===l.toStopId)?.progress?.completed && !l.booking && l.status !== 'routed');
      if (pending.length) {
        const mixedDays = new Set(pending.filter(l => l.preferredMode === 'mixed').map(l => l.dayId));
        const query = { ...route, legs: route.legs.filter(l => !l.booking && (pending.includes(l) || mixedDays.has(l.dayId))) };
        try {
          const result = await run.call('transport', `计算 ${query.legs.length} 段交通`, () => transport(transportRequest(query)));
          if (!mergeTransport(query, result, transportFingerprint(query))) throw new Error('transport mismatch');
          const updates = new Map(query.legs.map(l => [l.id,l]));
          route.legs = route.legs.map(l => updates.get(l.id) || l);
        } catch (error) {
          run.check(); if (error.code === 'AGENT_LIMIT') throw error;
          notices.push('部分交通未能查询，相关路段仍保留未知，可调整交通方式后再计算。');
        }
      }
      mergeTransport(route, { legs: route.legs }, transportFingerprint(route));
      await run.call('schedule', '计算每日时间与出行信息', () => applySchedule(route));
      return { metrics: metrics(route), notices };
    };
    run.calculate = calculate;
    const { previousRoute, feedback: initialFeedback, ...initial } = await seed(run);
    let best = clone(initial.route), stopReason = 'completed';
    let computed;
    try { computed = await calculate(best); }
    catch (error) {
      run.check(); applySchedule(best);
      computed = { metrics: metrics(best), notices: ['部分出行信息未计算完成，未知项已保留。'] };
      stopReason = error.code === 'AGENT_LIMIT' ? 'budget' : 'tool-unavailable';
    }
    const versions = [{ id: 'v0', label: '初始路线', route: clone(best), metrics: computed.metrics, reason: '已取得地点与出行信息，交由 AI 根据需求安排。', warning: initial.warning || '', changes: initial.conversation?.changes || [], notices: [...(initial.conversation?.notices || []), ...computed.notices] }];
    if (previousRoute) versions.push({ id: 'current', label: '修改前行程', route: clone(previousRoute), metrics: metrics(previousRoute), reason: '本轮修改前的行程，保留供你选择。', changes: [], notices: [] });
    let selectedVersionId = 'v0', reason = initial.conversation?.reply || '行程方案已准备好，请查看后采用。';
    let feedback = initialFeedback || { status: 'completed', changes: versions[0].changes, notices: versions[0].notices };
    // Measurements are observations for the model. They do not gate actions or
    // rank versions. Each action batch is followed by fresh tool feedback; the
    // last decision can only select a completed version and explain it.
    if (decide && stopReason === 'completed') for (let step = 0; step <= limits.rounds; step++) {
      const canAct = step < limits.rounds;
      let choice;
      try {
        choice = await run.call('decide', canAct ? 'AI 根据工具结果安排下一步' : 'AI 根据执行结果确定最终方案', () => decide({ route: clone(best), currentVersionId: selectedVersionId, versions: clone(versions), feedback: clone(feedback), canAct }), { model: true });
      } catch (error) {
        run.check(); stopReason = error.code === 'AGENT_LIMIT' ? 'budget' : 'model-unavailable'; break;
      }
      const actions = choice?.actions ?? [];
      if (!Array.isArray(actions) || actions.length > 12 || (actions.length && (choice.versionId || !canAct))) { stopReason = 'invalid-decision'; break; }
      if (!actions.length) {
        const selected = versions.find(version => version.id === (choice?.versionId || selectedVersionId));
        if (!selected) { stopReason = 'invalid-decision'; break; }
        best = clone(selected.route); selectedVersionId = selected.id;
        reason = choice?.reason || selected.reason;
        selected.reason = reason;
        stopReason = 'model-stopped'; break;
      }
      if (!execute) { stopReason = 'tool-unavailable'; break; }
      run.usage.rounds++;
      try {
        const edited = await execute({ route: clone(best), actions, run });
        const candidate = edited.route;
        const next = await calculate(candidate);
        candidate.revision = { ...best.revision, number: best.revision.number + 1, parentRevision: best.revision.number, updatedAt: new Date().toISOString(), reason: 'agent-actions' };
        const id = `v${versions.filter(version => version.id !== 'current').length}`;
        const parent = versions.find(version => version.id === selectedVersionId);
        const changes = [...parent.changes, ...(edited.changes || [])];
        const notices = [...new Set([...parent.notices, ...(edited.notices || []), ...next.notices])];
        versions.push({ id, label: `调整方案 ${run.usage.rounds}`, route: clone(candidate), metrics: next.metrics, reason: choice.reason || 'AI 根据工具结果调整行程。', warning: parent.warning || '', changes, notices });
        best = candidate; selectedVersionId = id;
        reason = (edited.changes || []).join('；') || '已执行 AI 调整并重新计算出行信息，请查看方案。';
        feedback = { status: 'completed', actions, changes: edited.changes || [], notices: [...(edited.notices || []), ...next.notices] };
      } catch (error) {
        run.check(); if (error.code === 'AGENT_LIMIT') { stopReason = 'budget'; break; }
        feedback = { status: 'failed', actions, error: ['CLARIFY','PLACES_UNMATCHED'].includes(error.code) ? error.message : '操作未完成；当前版本已保留，请调整动作后重试。' };
      }
    }
    const selected = versions.find(version => version.id === selectedVersionId);
    const interruption = !['completed','model-stopped'].includes(stopReason) ? 'AI 后续处理未完成，已保留最后完成的方案；请查看后采用或重新提出要求。' : '';
    const warning = [...new Set([selected.warning, ...selected.notices, coverageNotice(best), interruption].filter(Boolean))].join(' ');
    run.check();
    run.usage.tokenUsageComplete = run.usage.tokenUsageComplete && run.modelReports === run.usage.modelCalls;
    return { ...initial, route: best, warning, ...(initial.conversation ? {conversation: {...initial.conversation, reply: reason, changes: selected.changes, notices: selected.notices}} : {}), agent: { limits, usage: { ...run.usage }, versions, selectedVersionId, reason, stopReason, trace: run.trace, boundary: 'AI 根据工具结果决定操作和方案；程序提供真实数据、计算与执行。最多2批操作及一次最终决定，不保证最优或实地可行。' } };
  });
  try { return await Promise.race([work, aborted]); }
  finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', cancel); controller.signal.removeEventListener('abort', removeAbort); }
}
module.exports = { runAgent, metrics, LIMITS };
