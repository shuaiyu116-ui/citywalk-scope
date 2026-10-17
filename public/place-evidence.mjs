const labels = { matched: '已匹配', substituted: '采用备选', unresolved: '未能匹配', ambiguous: '同城同名，需补充地址', address_mismatch: '地址线索未能对应，请核对分店', not_found: '未找到准确名称', wrong_city: '同名地点城市不符', missing_city: '缺少可核实的城市', service_error: '地点服务暂不可用', duplicate: '与前面站点重复' };
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const timeLabel = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）' : '未知';
function sourceLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    const link = element('a', '查看地点来源');
    link.href = parsed.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  } catch { return null; }
}

export function renderPlaceEvidence(route, selectStop) {
  const panel = document.querySelector('#placeEvidence');
  panel.replaceChildren();
  const proposal = route.proposal;
  panel.append(element('summary', proposal ? '路线提案、备选与地点依据' : '地点依据与开放信息'));
  const body = element('div', ''); body.className = 'place-evidence-body';
  if (proposal) {
    if (route.revision?.reason !== 'generated') body.append(element('p', '以下提案记录为生成时的历史依据；用户编辑后的实际地点与来源见下方“当前地图地点的依据”。'));
    body.append(element('p', route.source === 'deepseek' ? '以下是 AI 推荐理由和逐站匹配结果。地点匹配不代表日期、营业或交通已校验。' : '以下保留原提案的匹配记录；当前地图展示城市示例，并非这次需求的规划结果。'));
    if (proposal.rationale) body.append(element('p', `AI 规划思路：${proposal.rationale}`));
    const list = element('ol', '');
    for (const slot of proposal.stops || []) {
      const row = element('li', '');
      row.append(element('strong', `${slot.city} · ${slot.name} — ${labels[slot.status] || '未完成匹配'}`));
      if (slot.reason) row.append(element('p', `推荐理由：${slot.reason}`));
      for (const attempt of slot.attempts || []) {
        row.append(element('p', `${attempt.role === 'primary' ? '主选' : '备选'}：${attempt.city} · ${attempt.name} · ${labels[attempt.status] || '未核实'}${attempt.role === 'alternative' && attempt.reason ? `；${attempt.reason}` : ''}`));
        if (attempt.matchMethod === 'semantic') row.append(element('p', `名称核对：${attempt.matchReason || '已对照携程候选'}${attempt.status === 'matched' ? ' 地点坐标与链接均来自携程。' : ''}`));
        if (attempt.status === 'ambiguous') row.append(element('p', `同名候选：${attempt.candidates.map(poi => `${poi.name}（${poi.address || '地址未知'}）`).join('；')}`));
      }
      list.append(row);
    }
    body.append(list);
    if (proposal.status === 'partial' || route.source !== 'deepseek') {
      const retry = element('button', '补充地点名称或地址后重新生成'); retry.type = 'button'; retry.className = 'trip-reset';
      retry.addEventListener('click', () => document.querySelector('#promptInput').focus());
      body.append(retry);
    }
  }
  body.append(element('h3', '当前地图地点的依据'));
  route.stops.forEach((stop, index) => {
    const record = element('section', '');
    const button = element('button', `${index + 1}. ${stop.city || route.city} · ${stop.name} · 查看地图`);
    button.type = 'button'; button.className = 'evidence-stop'; button.addEventListener('click', () => {
      selectStop(index); panel.open = false;
      document.querySelector('.spatial-stage')?.scrollIntoView({ block: 'center', behavior: 'auto' });
    }); record.append(button);
    const location = route.evidence?.find(item => item.subjectId === stop.id && item.field === 'location');
    const opening = route.evidence?.find(item => item.subjectId === stop.id && item.field === 'openingHours');
    record.append(element('p', `地点来源：${location?.source || '未知'}${location?.status === 'demo' ? '（演示数据）' : '（身份匹配，未独立核实）'}`));
    record.append(element('p', `获取：${timeLabel(location?.retrievedAt)}；供应商更新：${timeLabel(location?.providerUpdatedAt)}`));
    record.append(element('p', opening?.status === 'reported' ? `开放信息：${opening.text}（供应商提供，尚未校验出行当天）` : '开放信息：未知，请出发前向场所核对。'));
    if (opening?.status === 'reported') record.append(element('p', `开放信息来源：${opening.source || '未知'}；获取：${timeLabel(opening.retrievedAt)}；供应商更新：${timeLabel(opening.providerUpdatedAt)}`));
    const link = sourceLink(location?.url || stop.detailUrl); if (link) record.append(link);
    body.append(record);
  });
  panel.append(body);
}
