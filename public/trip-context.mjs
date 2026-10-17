const fieldIds = { startDate: 'tripStartDate', dayCount: 'tripDayCount', dailyStartTime: 'tripDailyStart', dailyEndTime: 'tripDailyEnd', transportMode: 'tripTransport', maxWalkKm: 'tripMaxWalk' };
const transportLabels = { walking: '步行', cycling: '骑行', transit: '公共交通', driving: '自驾', taxi: '打车', mixed: '混合出行' };
const companionLabels = { none: '无特殊条件', children: '带儿童', seniors: '有老人', wheelchair: '轮椅通行', stroller: '带婴儿车' };

export function readTripContext() {
  const context = {};
  for (const [key, id] of Object.entries(fieldIds)) {
    const value = document.getElementById(id).value;
    if (value !== '') context[key] = ['dayCount', 'maxWalkKm'].includes(key) ? Number(value) : value;
  }
  const companions = [...document.querySelectorAll('[name="tripCompanion"]:checked')].map(input => input.value);
  if (companions.length) context.companions = companions;
  return context;
}

function validateTimeWindow() {
  const start = document.getElementById('tripDailyStart').value;
  const end = document.getElementById('tripDailyEnd');
  end.setCustomValidity(start && end.value && end.value === start ? '每日开始和结束不可相同；结束早于开始表示次日。' : '');
}

export function initTripContext() {
  for (const id of ['tripDailyStart', 'tripDailyEnd']) document.getElementById(id).addEventListener('input', validateTimeWindow);
  document.querySelectorAll('[name="tripCompanion"]').forEach(input => input.addEventListener('change', () => {
    if (!input.checked) return;
    document.querySelectorAll('[name="tripCompanion"]').forEach(other => {
      if (other !== input && (input.value === 'none' || other.value === 'none')) other.checked = false;
    });
  }));
  document.getElementById('resetTripConditions').addEventListener('click', () => {
    Object.values(fieldIds).forEach(id => { document.getElementById(id).value = ''; });
    document.querySelectorAll('[name="tripCompanion"]').forEach(input => { input.checked = false; });
    validateTimeWindow();
  });
}

export function validateTripForm(reveal = () => {}) {
  validateTimeWindow();
  const form = document.getElementById('routeForm');
  if (!form.checkValidity()) {
    document.getElementById('tripOptions').open = true;
    // Associated fields live on the settings page. Reveal them before native focus.
    const invalid = [...form.elements].find(field => field.willValidate && !field.validity.valid);
    if (invalid) reveal(invalid);
  }
  return form.reportValidity();
}

export function renderTripContext(route) {
  const summary = document.getElementById('tripContextSummary');
  const context = route.context;
  summary.replaceChildren();
  if (!context) return;
  // Keep the editable form as the user's draft; echo the returned normalized
  // conditions separately so late replies cannot overwrite a newer draft.
  const parts = [context.startDate || '日期未指定', `${context.dayCount} 天${context.fieldSources?.dayCount === 'default' ? '（默认）' : ''}`];
  parts.push(context.dailyStartTime || context.dailyEndTime ? `每日 ${context.dailyStartTime || '未指定'}–${context.dailyEndTime || '未指定'}${context.dailyStartTime && context.dailyEndTime && context.dailyEndTime < context.dailyStartTime ? '（结束于次日）' : ''}` : '每日时段未指定');
  parts.push(`${transportLabels[context.transportMode] || '未指定'}${context.fieldSources?.transportMode === 'default' ? '（默认）' : '偏好'}`);
  parts.push(context.maxWalkKm == null ? '步行预算未指定' : `每日步行 ≤ ${context.maxWalkKm} km${context.fieldSources?.maxWalkKm === 'intent' ? '（模型推断）' : ''}`);
  parts.push(context.companions.length ? context.companions.map(item => companionLabels[item]).join('、') : '同行条件未指定');
  const title = document.createElement('strong');
  title.textContent = '本行程记录的条件（各日时段可在编辑中单独设置）';
  const description = document.createElement('p');
  description.textContent = parts.join(' · ');
  const notices = document.createElement('p');
  notices.textContent = route.planning?.notices?.join(' ') || '';
  summary.append(title, description, notices);
}
