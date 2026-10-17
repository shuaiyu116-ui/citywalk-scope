# 行程契约 v1（W01–W04）

2026-10-16：现有 Node / 原生前端中的增量契约。实现入口 `lib/itinerary.js`，表单行为 `public/trip-context.mjs`。没有新框架或数据库。

## 请求与优先级

`POST /api/generate-route` 保持 `{prompt, apiKey?}` 兼容，新增可选 `context`：

```json
{
  "prompt": "上海，想逛街区",
  "context": {
    "startDate": "2026-10-18",
    "dailyStartTime": "09:00",
    "dailyEndTime": "18:00",
    "dayCount": 2,
    "transportMode": "mixed",
    "companions": ["children", "seniors"],
    "maxWalkKm": 3.5
  }
}
```

| 字段 | 输入和返回规则 |
| --- | --- |
| startDate | 2000–2099 年的真实 `YYYY-MM-DD` 日期；空值返回 null，不自动套用今天 |
| dailyStartTime / dailyEndTime | `HH:mm`，每天重复的用户可用时段；允许只填一端。两端都填时起止不可相同；结束早于开始表示次日（W04） |
| dayCount | 1–14 的整数，未指定默认 1；表单留空仍能区分默认和明确设置 |
| transportMode | walking / cycling / transit / driving / taxi / mixed，未指定默认 walking |
| companions | none / children / seniors / wheelchair / stroller 数组，去重；none 与其他值互斥。空数组是未指定，明确无特殊条件填 `["none"]` |
| maxWalkKm | 每天步行上限 0–50 km，可小数，0 是明确不步行；未提供且未推断时为 null |

数值允许 JSON 数字或十进制数字字符串；布尔、数组、非有限数不当作数值。未知键丢弃，密钥不得放进 context。非法字段在外部调用之前返回 HTTP 400 `{error, field}`。顶层旧 `apiKey` 仍仅用于认证。

`normalizeTripInput` 仅保留明确的非空条件；`resolveTripContext` 形成全部字段及 `fieldSources`（user / intent / default / unknown）。当前模型旧意图中只有 maxWalkKm 合并入 context；其余新增字段依赖表单。优先级：本次表单 > 已支持的模型意图 > 默认值 > 未知。`applyTripContext` 将 maxWalkKm 覆盖到旧 intent，并在两端时间齐全时用时段长度覆盖 durationMinutes；完整 context 同时传给路线模型。旧意图的 null 不再被 Number(null) 错当成 30 分钟 / 0.5 km。

前端输入是尚未提交的草稿，`tripContextSummary` 回显的是服务端返回的当前行程条件。异步响应不回填并覆盖用户正在编辑的输入；“清空出行条件”只清空草稿，不修改当前路线。模型推断的距离和默认天数/方式有相应标识。

## 响应中的 route

所有生成结果（含无 Key、候选不足、模型失败回退）及 `GET /api/demo-route` 都返回 v1。

| 字段 | 语义与限制 |
| --- | --- |
| schemaVersion | 数字 1，数据结构版本，与 revision 分开 |
| id | 一次生成分配 `trip-UUID`，每次新生成是新行程 |
| revision | number=1、parentRevision=null、createdAt、updatedAt、reason=generated；时间使用 UTC ISO 字符串 |
| context | 上述条件与来源，返回白名单字段，不含 Key 或原始请求对象 |
| days | `id/index/date/requestedWindow/status/stopIds/legIds`；日期按纯日历日递增、不受宿主时区影响。未选日期为 null |
| stops | 旧字段加 `id/dayId/schedule/evidenceIds`；schedule 为 `{status:unknown,arrival:null,departure:null,stayMinutes:null}` |
| legs | `id/dayId/fromStopId/toStopId/preferredMode/mode/status/geometry/distanceMeters/durationMinutes/source/retrievedAt/evidenceIds`；preferredMode 是偏好，mode 和测量值是 null，status=unknown |
| evidence | `id/subjectId/field/status/source/url/retrievedAt/verifiedAt`；W01 有 location 与 openingHours 两类 |
| planning | draft、排程/交通 unknown、分日待安排标识，以及面向用户的 notices |
| source / poiSource | 保留路线上下文来源；示例回退的 route.poiSource=mock，外层 poiSource 仍可能是先前尝试的数据源，不能混用 |

`city/title/summary/duration/distance/mood/stops` 与站点的 time/name/type/note/location、图片等旧字段保留，现有卡片和地图不需迁移。内部仍为 WGS84 `{lat,lng}`，前端地图转换不变。

`createItinerary` **仅用于新生成的旧结构路线初次升级**，不是导入校验器或编辑器。创建后站点、分日、路段、证据 ID 不依赖数组序号；重排应修改顺序/引用，不能重新调用该函数而丢失身份。后续 W05 编辑保留 id、增加 revision.number、记录父版本，增删点才增删实体；W11/W12 实现导入时另做 schema 校验，不接受客户端任意对象直接传播。

## 真实边界与后续模块

- W01历史生成器曾全部暂列第1天；W06已改为按原顺序初步均分到各天，地点少于天数时保留空天，不复制路线充数。此分配非优化，后续编辑和Agent以days/legs为准。
- `time/duration/distance` 为兼容显示文字，不是已核实排程。W04 已由独立排程工具写入 schedule 并检查日期、开放与预算；保留旧文字仅为兼容。
- 地点 evidence 的 matched 只表示来自携程候选匹配，不代表独立真实性或营业验证；retrievedAt 是本次结果组装时刻，**不是供应商事实更新时间**；verifiedAt=null。示例标 demo，开放时间始终 unknown。W02 当前来源规则见下节，此段只描述 W01 历史行为。
- W03 已替换前端 walkingPath 预览层，详见下节。旧 walking 接口只为兼容保留，不能混用为其它方式。
- 条件回显不表示条件已满足。多日、非步行、预算和可达性均有待排程提示。W02 已取消 identity 查询的附近半径，旧步行附近入口保留。
- 本次 Key 只用于请求鉴权；行程按白名单拷贝旧字段，未保存 request/apiKey、未知嵌套对象或完整对话。JSON 导出使用 route，自然带上 v1 字段。后续路书/分享也必须沿用隔离边界。

## W01 验证

`node --test test/itinerary.test.cjs`：4 项通过，包含真实本地 HTTP 服务 + 模拟模型，子进程 preload 屏蔽 .env 凭据并拒绝外网请求。覆盖旧调用、三城 GET/POST、非法日期/数值、显式零预算/时段优先级、失败回退保留条件、身份引用和密钥隔离。

语法检查：server.js、public/app.js、public/trip-context.mjs、lib/itinerary.js 通过。浏览器一次会话覆盖错误时段拦截、有效提交和回显、同行互斥/清空、390px 与 1280px 布局。截图 `output/playwright/w01-conditions.png`。浏览器底图有正常外网加载，但 DeepSeek / 携程 / 图片检索 / Valhalla 未作真实服务联调，测试服务在完成后停止。

## W02：提案、地点身份与证据

生成顺序：analyzeIntent → proposeWithDeepSeek（完整 prompt + intent.context）→ matchProposal → 图片补全 → createItinerary。旧基于候选的 generateWithDeepSeek/normalizeRoute 已移除。意图规范化仍按 W01 合并条件，未把任意模型字段写入 context。

- `route.proposal`：id、source=deepseek、status=matched/partial/proposed、createdAt、city/title/rationale/mood、stops。提案不是执行时间表；rationale/reason 为 AI 推荐文字，不能作为事实证据。
- proposal.stops 每个 slot：id、name/city/reason、status=matched/substituted/unresolved、selectedPoiId/selectedCity/selectedIndex、attempts。每站最多一个备选。attempts 有 role、name/city/reason、status、source/provider/retrievedAt、candidates（白名单 POI、坐标、openingHours 与时间来源）；proposed 表示因后续异常尚无完整匹配记录。
- 匹配状态：matched、ambiguous、address_mismatch、wrong_city、missing_city、not_found、duplicate、service_error。匹配采用 Unicode 标准化和少量空白/分隔符规范化后的全名相等 + 城市相等；同名地址线索不对应时拒绝，缺少城市不可冒充匹配。此策略保守，别名/供应商名称变体可能无法匹配，留给后续带证据的澄清或编辑，不能靠 substring 自动认成同一地点。
- 只有唯一已匹配地点进入 route.stops；主选失败尝试备选，保留所有匹配记录。至少两站时可返回 partial 路线并提示；不足两站时明确 demo-fallback，route.poiSource=mock，但仍保留原 proposal，地图示例和原提案在页面中明确区分。
- route.stops 增加 `city/address/proposalCandidateId/selection/openingHours`。selection={status,requestedName,requestedCity,selectedIndex,rationale}。proposalCandidateId 引用 slot.id；这些不是 dayId 或 poiId。只在初次生成时分配 UUID，后续编辑保留身份。
- 最终名称、城市、坐标、来源链接来自适配器，模型坐标/开放时间/票价/URL 会被提案白名单丢弃。title/rationale/reason 仍是未独立验证的推荐文案，不等同 location/openingHours evidence。
- evidence 增加 `providerUpdatedAt`，所有缺失时间为 null。location.status=matched 仅为匹配，source 为 ctrip-mcp/ctrip-http，retrievedAt 是实际查询完成时刻；verifiedAt=null。示例为 demo/local-demo，retrievedAt=null，不再使用封装时刻冒充查询时刻。
- `openingHours` 为 `{status,text,source,url,retrievedAt,providerUpdatedAt,verifiedAt}`；当前 MCP 缺少已核实开放字段，统一 unknown/null。旧通用 HTTP 适配器可提供显式 `{status:'reported',text,providerUpdatedAt?,url?}`，显示为供应商提供且未校验当天。reported 不代表 verified，开放与地点的供应商更新时间分别保存。
- 通用 HTTP 真实匹配需供应商 id、city 和有效 WGS84 坐标；不再合成假的 poi-ID。缺字段记录无法匹配，不能按请求城市给缺城市结果补造身份。适配器可返回 detailUrl、address、providerUpdatedAt、openingHours；字段按白名单投射。
- `createItinerary` 对 proposal、selection、openingHours 做白名单拷贝；候选、来源和匹配记录可随 JSON 导出。请求、鉴权 Key、任意上游嵌套字段不传播。

W02 历史边界：当时全部点暂列第一天、schedule/legs 未求解。W03已替换交通预览层；schedule由W04完成，W06已扩展多日和跨城组织。

W02 本地验证：4 项 route-planner 测试通过（含实际本地 HTTP + 模拟 DeepSeek/MCP/通用 HTTP），受影响 W01 HTTP 与 MCP identity 各一项通过；不代表真实服务联调。浏览器一次会话验证依据展开、同名冲突/替换提示、地点联动/聚焦，390px/1280px；未重跑历史全套。详细记录见 AGENTS.md。


## W03：分段交通

生成响应仍保留 unknown legs，浏览器随后请求 `POST /api/transport-route`。后续内部 Agent 可直接调用 `solveTransport`，不必依赖浏览器；这次未将交通等待加入生成链。

请求最小对象：`{stops:[{id,city,location:{lat,lng}}],legs:[{id,dayId,fromStopId,toStopId,preferredMode}],context:{maxWalkKm}}`。2–50 地点、最多 49 段，验证有效坐标、唯一身份、引用、方式及预算后发起外部查询，3 并发/单次12秒。上游 URL 仅来自服务器环境变量，客户端不能指定。返回 `{legs}`，不是整个客户端对象回显。

- `preferredMode` 保持偏好；`mode` 是本段道路/粗估采用方式；尚不支持的公交或跨城方式为 null。
- 步行 pedestrian、骑行 bicycle、自驾/打车 auto。打车沿机动车路由，不是出租车订单查询，不含候车/实时拥堵；自驾不含停车及停车后步行。
- mixed 为可解释的初步建议：同城直线不超过1.5km、暂估步行预算允许则步行，否则打车；采用直线×1.3累计每日暂估预算。不会假称优化或硬预算通过，实际道路更长时由 W04 报冲突。不会自动让用户租自行车。
- 公交无时刻/换乘适配，status=unavailable。不同城市或缺城市时，除明确 driving/taxi 外不请求道路。明确机动车可跨城查道路，但不代表已安排日期/预订。跨城或直线超过50km的道路失败不提供固定速度粗估。
- `status`: routed / estimated / unavailable（初始unknown）；`routingStatus`: success / failed / unsupported；`routingSource`: valhalla 或 null。source 分别 valhalla / local-estimate / null。
- 几何为 `{type:'LineString',coordinateSystem:'wgs84',coordinateOrder:'lat-lng',kind:'road'|'straight-line',coordinates:[[lat,lng],...]}`。虽 type 类似 GeoJSON，这里**不是 GeoJSON 经纬度顺序**。前端统一消费；仅绘制高德时转 GCJ-02。unknown/unavailable geometry=null，渲染器可画虚线连接但不写入道路几何或填造耗时。
- distanceMeters / durationMinutes 为对应方式的道路模型值或明确粗估。未知为 null，不当0。routed 也不是实地通行或出发当天实时交通验证。
- `retrievedAt` 只在实际获得有效道路结果时填写；`attemptedAt` 是查询尝试时刻；`computedAt` 为本次处理时刻。没有提供者事实更新时间。warning 为安全固定文案，不传播原始上游错误或凭据。
- estimated 额外 `estimate:{straightLineMeters,detourFactor,speedKmh}`；同城短途失败使用步行1.3/4.5kmh、骑行1.35/15kmh、机动车1.4/25kmh。虚线仍是直线示意，不冒充所估绕行道路。
- `selectionReason` 说明方式选择；evidenceIds 暂为空，来源/时刻自包含于 leg。后续证据整合不能把这些值升级为现场核验。
- `days[].transport`：durationMinutes、distanceMeters、walkingMeters 为已知路段小计；unknownCount、estimatedCount、legCount 必须伴随消费。unknownCount>0 时不得展示为完整总耗时；无路段的空白天显示待安排。
- `planning.transportStatus` 为 routed / estimated / incomplete；不是 scheduleStatus 或约束通过。route.distance 更新为全部方式交通距离（含“约/已知部分/未知”），不再表示全部步行。
- 前端 `transportSegments` 是2D/3D共用几何入口，按方式着色，非道路虚线；3D每段简化以控制网格量，不将不同路段之间补接为真实道路。自动试走仍仅空间预览。
- 交通请求可以重试；新请求中止上一前端请求，结果必须同时匹配请求序号、当前行程对象、revision.number、最小请求指纹（ID/端点坐标/城市/方式/预算）。mergeTransport 再按 leg ID/端点/日期引用校验，重排的响应不覆盖错误的段。
- 更新派生交通数据不重建实体或增加语义 revision。W05 修改偏好/顺序/停留等时应增加 revision，并重新请求受影响交通。最终导出 JSON 包含当前 legs 及 days.transport。

配置：`TRANSPORT_ROUTER_URL` 优先覆盖所有方式，必须是支持 Valhalla costing 的服务；未配置时步行可用旧 `WALKING_ROUTER_URL`，其余方式使用默认 Valhalla 公共服务。无新必需密钥；仍不能保证默认海外服务的国内网络可用性。

本地验证：`node --test test/transport.test.cjs` 4项通过，含本地 HTTP + 离线模拟；一次1280px/390px浏览器会话覆盖道路/粗估/重试/地点联动/2D/3D，控制台无错误。未真实联调、未部署、未更新ZIP。W04 接续应使用 legs 数值和状态，不应从旧 time/duration 文案推断已核实排程。

## W04：时间轴与硬约束排程

纯工具 `public/schedule.mjs` 可供浏览器直接 import，Node 内部工具可 `await import('../public/schedule.mjs')`；不需新增服务或依赖。`solveSchedule(route)` 不修改输入，返回 `{stops:[{id,schedule}],days:[{id,schedule}],scheduleStatus,timezone:'Asia/Shanghai'}`。`applySchedule(route)` 按 ID 写入派生结果，不重建实体、不增加 revision。不是任意不可信行程的导入校验器。

生成响应仍为初始 unknown schedule/legs；网页 `updateTransportView` 在交通请求开始、成功或失败时重新排程。时间轴、卡片/地点列表、当前地点与出发/结束标签消费同一 schedule；不再把旧 stop.time 当实际时刻。旧顶层 duration/time 文字仅保留兼容，导出/路书应优先消费 schedule。

- 时刻对象为 `{date:'YYYY-MM-DD'|null,time:'HH:mm',dayOffset:number}`，缺少开始时刻或前序未知交通时整个对象为 null。date/dayOffset 使用纯日历运算，时区语义 Asia/Shanghai，不依赖运行机器时区；未指定日期仍可展示相对时刻，但星期/闭馆日检查保持未知。显示分钟向上取整。
- 每日 requestedWindow.start/end 可跨午夜：end < start 是次日，end === start 在表单和服务端均拒绝；不把相同起止猜作24小时。applyTripContext 用模1440分钟计算模型可用时长。只填一端不会编造另一端。
- 站点 `visit` 为用户输入：`stayMinutes` 整数0–720、`restMinutes` 整数0–240，留空分别暂按30/0。旧模型 time/duration 不用于提取停留时间。休息位于游玩结束之后、离站之前，按场馆外休息处理。初始默认假设明确展示，停留默认会使整体状态保持 unknown。
- 可选 `visit.openingRules = {periods:[{start,end}],closedWeekdays:[0..6],closedDates:['YYYY-MM-DD'],validFrom,validTo,source:'user',note,recordedAt}`。0为星期日，最多8时段/100特殊日期；所有日期和数字验证后投射白名单。适用于用户查到的固定每日时段和闭馆规则，不擅自解析供应商自然语言。有效日期可省略，省略表示用户未限定规则期限，不表示官方永久有效。来源说明最多300字，recordedAt为填写时刻，不是事实更新时间。
- 对已有规则按实际到访日期核查：合并重叠/相邻时段，营业前到达可等待，午休分段必须找到能容纳完整停留的连续窗口。跨午夜营业可承接前一日的开放窗口；每周/特殊闭馆日优先，整日闭馆会截断前日跨夜窗口。规则有效期外为 unknown；不悄悄把闭馆访问推到另一天。完整日期/季节变化等复杂规则尚需人工确认，非自动全网营业查询。
- `openingHours.status=reported` 的供应商文字仍是未知，不能当作全天开放或已核实当天营业。用户规则显示“用户提供，未独立核实”，保留原供应商 evidence 不改写。无可核查规则时 waitMinutes=null，时间轴仅按“不额外等待”假设推算，约束不判通过；已知冲突也保留假设时间供修改参考。
- stop.schedule 包含 status、arrival、visitStart、visitEnd、departure、stayMinutes/staySource、restMinutes、waitMinutes、timingBasis、openingSource、checks。status 为 conflict / unknown / provisional；provisional 仅表示所填条件下暂未发现冲突，不是可达性认证。timingBasis=model/estimated；model也不是实时交通。
- day.schedule 包含 start/end/deadline、elapsedMinutes、stayMinutes/restMinutes/knownWaitMinutes、transportMinutes/walkingMeters已知小计、unknownLegCount/estimatedLegCount、checks。空天为 unplanned，不复制路线。步行预算按每日有效路段累计，不包括景区内部、停车后等尚未建模的步行。
- 交通按 day.legIds + 同day + 相邻端点身份查找唯一段；unknown/unavailable/缺失/无效数值均让后续时刻与当日结束为 null。estimated 可推算但保留未知检查。对已知步行小计已超预算仍报告冲突；小计未超但有未知/估算段时不能宣告通过。超时或超距的估算依赖明确标注。
- checks 为 `{code,status:'pass'|'conflict'|'unknown',message,suggestions?,stopId?}`；建议 type 为 shorten-stay / replace-stop / remove-stop / change-mode / retry-transport。具体可行的缩短停留有 stopId/minutes，可一键应用再算；换点/删点在 W04 为建议，执行入口由 W05提供。每日总超时不盲目自动删点。
- `public/schedule-view.mjs` 表现层提供时间轴、问题、地点联动、规则表单/错误恢复/重置/一键缩短。交通刷新只刷新结果，保留未保存的规则表单；JSON导出包含已保存 visit、schedule 和 revision，不含未保存草稿。
- 停留/休息/开放规则编辑增加语义 revision（reason=schedule-settings、parentRevision旧号），保留实体ID；中止旧交通请求并使序号失效，必要时重启尚未获取的交通。单纯派生排程和交通更新不增加版本。W05需把该编辑入口统一纳入草稿、提交、撤销模型，避免第二套不兼容状态。

W04 本地验证：5项 schedule 定向测试通过（含本地HTTP，外部上游全部模拟），受影响 W01 日期/时段2项通过；app/schedule-view/trip-context语法通过。一次1280px/390px浏览器会话覆盖跨年表单、等待/休息、一键缩短、非法/特殊闭馆日、地图联动、交通重试保留草稿、JSON导出revision；控制台无错误、手机无横向溢出。截图在 output/playwright/w04-schedule-*.png。未真实联调DeepSeek/携程/百度/Valhalla，未部署/刷新ZIP。

## W05：编辑事务与地点检索（W06在下节扩展）

`public/itinerary-editor.mjs` 提供无DOM `editRoute(base, action)`、`reconcile(route,before)` 与 `EditSession`。这是当前可信行程的内部编辑器，不是任意JSON导入校验器。`createItinerary`仍只用于初次升级。

- action：visit（复用normalizeVisit）、lock、move（当天offset±1）、remove、mode（legId/mode）、add/replace（服务端检索返回poi）。至少2点、最多50点；必去锁定阻止删除/替换，仍允许排序、调整停留或主动解锁。锁定随JSON导出，未来Agent必须遵守。
- `EditSession.current`为已提交版本；`draft`为结构化克隆，stage不更改当前版；`commit(solve,{allowIncomplete})`先计算受影响交通、应用排程，再原子提交并递增revision（reason=user-edit）。默认道路粗估/不可用或HTTP失败保留当前版和草稿；可重试、取消、放弃，或用户明确点击“保留粗估/未知并提交”。约束冲突不会伪装通过，也不自动删点。
- 撤销保存最多20次提交前快照，仅当前页面会话有效；undo恢复内容但revision继续递增、reason=undo，不倒退版本号。新生成清空会话历史。不属于W12收藏/持久历史，刷新会丢失。
- 未变站点和路段保持ID/数据。换点分配新stop ID、清空visit与旧开放规则/照片/证据，新地点依据独立写入。保留proposalCandidateId以便回到原主选/备选；proposal本身是生成时历史，不改写成编辑后决策。已编辑界面标明原始summary可能不再适用，导出仍保留该历史summary，消费者应以stops/days/legs为准。
- reconcile按照每个day的站点顺序更新stopIds/legIds，端点或方式变化生成unknown路段，geometry/耗时清空；未变路段复用。mixed依赖当天累计预算，相关顺序或方式修改使该天路段整体失效重算。停留/锁定编辑不重查未改变的routed或estimated结果。
- 编辑交通只提交受影响段，mixed必要时包含当天其它段供预算计算。普通交通刷新沿用W03对象/revision/指纹保护；编辑提交额外使用token、AbortController、超时及独立candidate对象保护；新stage、取消、撤销、新行程使旧响应失效。查询地点也有查询序号、会话身份和取消保护。
- 新 `POST /api/places/search` 输入 `{name,city,addressHint?}`，仅从已有携程MCP/通用HTTP/本地示例适配器获得坐标；采用W02 identity，不使用旧步行半径。返回 `{status,candidates,source,message}`；严格名称/城市/有效坐标，matched或ambiguous才给可选结果，同名需用户按地址明确选择。异城可能已被MCP过滤为not_found；缺城市400、服务异常502安全文案。不会接受用户/模型传入的坐标冒充真实地点。保留 `/api/ctrip/pois`。
- UI统一从当前已提交版本渲染地图/故事卡/时间轴/导出。草稿在独立编辑面板明确展示，主选/备选按钮重新查询身份，“换一个”可检索指定地点；W06新增追加到当前编辑日。W04规则表单与缩短建议也是stage，不再直接修改route；需点击编辑面板计算并提交。
- schedule-view按route.id与语义revision重建已保存表单；普通派生交通刷新不毁未提交输入。放弃编辑草稿显式恢复已保存规则表单，撤销按新revision同步。新unknown交通在planning.transportStatus标incomplete，不能把未知写成estimated或0耗时。
- route.poiSource允许mixed表示当前地点包含不同来源；来源真实性必须逐点看evidence，原route.source表示最初生成来源。图片缺失不能因原路线为demo就标成存在的演示图。

W05验证：4项editor定向测试通过（实体/事务/版本竞争/mixed依赖/本地HTTP），后续交通unknown状态修正重跑事务项及受影响W03共享几何项通过。一次浏览器会话覆盖桌面/手机编辑、失败/撤销、表单回显/导出、主备选和2D/3D；控制台无错误。外部服务全部模拟，未部署或刷新ZIP。详细验证范围及最后微调边界见AGENTS.md。

## W06：分日、跨城与预订交通（当前）

沿用schemaVersion=1及EditSession。`createItinerary`只用于初始生成，按原站点顺序均分到min(天数,地点数)个非空日，其余为空，不承诺优化或自动找到住宿。稳定day/stop/leg/evidence身份和revision继续沿用。1–14天、2–50次到访、最多49段。

- `days`数组为时间顺序；`stops`数组按days顺序串联，每日内部顺序即stopIds。`reconcile`建立全部连续到访的N-1条leg，跨空白天也连接前一个非空日终点。所有leg归属**到达日dayId**，增加`fromDayId`、`kind:local|interday`。day.legIds包含入境衔接，不能只按日内相邻点推断全程。未改端点/方式尽量复用；端点或目标日变动不沿用旧预订。
- `days[].date/requestedWindow`可逐日设置；有日期的各天严格递增，未填日期保持null。`restMinutes`为当天第一次游玩前额外休息0–720分钟，安排在入境交通/接驳之后（首日为时段开始后）。各站休息仍用visit.restMinutes，不替代。`lodging:{status:user-reported|unknown,text,source:user}`只存用户备注，不用于定位、求路或生成住宿事实。
- 新编辑action：`day`（date/start/end/restMinutes/lodging/startStopId/endStopId）、`add-day`、`remove-day`（仅空日且至少保留1日）、`assign-day`（追加目标日末尾）、`endpoint`（内部重排）、`booking`、`repeat-stop`。UI每天起终点选已有核对地点；新酒店/车站通过原地点检索加入。重复到访明确复制已有POI及证据为新stop/evidence ID，清空visit/locked，支持返程或再次移日；不能借此复制旧开放规则。原必去点不被删除/替换，移日仍保留锁定。
- 新预订输入`leg.booking={departure,arrival,beforeMinutes,afterMinutes,label,durationMinutes,source:'user',verifiedAt:null}`。日期时间格式YYYY-MM-DDTHH:mm，语义Asia/Shanghai，无主机时区转换；结束晚于开始且不超过14天。label最多120字；before/after是前一地点至发车/起飞、到站/落地至后一地点的接驳/候车缓冲，各0–1440分钟，**留空为null而非0**。不记录订单或旅客信息，不查询/编造班次、余票、票价、酒店。
- 有booking时leg.status=`scheduled`、mode=`transit`、source=`user`，durationMinutes只为出发到到达时长；geometry/distanceMeters/retrievedAt仍null。地图虚线仅连接到访地点，不代表铁路、航线或接驳路径。改方式/清空booking重新生成unknown道路段。普通道路API请求过滤booking，最小指纹另含booking；mergeTransport保留用户预订，不允许道路刷新覆盖它。scheduled在总状态中仍incomplete，不能当供应商核实的routed。
- summarizeLegs计入用户预订时长，但unknownCount仍包括其未知距离/未核实情况，bookedCount单列。日交通汇总把完整跨日段归属到达日，故可能超过本日日内elapsed；UI注明可能覆盖前一日期。顶栏“日内约…分钟”是各日开始到结束小计，跨夜时段外交通另看分段交通，不能冒称完整旅程总耗时。
- solveSchedule按日顺序解算，跨日入境段消费上一非空日最后一站实际推算结束时间及日期差（都未填日期则按day.index间隔，只有一侧有日期则未知）。普通道路默认在本日开始时从前日终点出发，若前日结束更晚则延后；明确提示住宿/夜间位置未核实。未知跨城道路保持unknown，不套市内步行，也不因换日重置成可行。
- 预订段按固定日期锚定到达，核查前序结束+出发缓冲是否晚于交通出发；错过班次、到达不在安排日范围或早于前日行程标conflict。缺日期或缓冲使后续时刻null；前序时刻未知但预订到达已知时可给出条件下的到达推算，赶车仍unknown，不宣告可行。同日预订计入候车等待；下一非空日检查包含前日跨午夜结束。
- `day.schedule.remainingMinutes`为deadline减当日推算结束，最低0；`playBudgetMinutes`为剩余加已安排停留，体现交通/接驳/等待/休息后的条件下游玩预算。结束未知则二者null；已超时由原end-window冲突明确指出。未知开放等仍保留unknown，因此有数字也只是条件下假设，不是认证。空天unplanned、无重复路线或假造住宿。
- 按日预览是已提交行程的投影`daySubset`，不会删除原实体：卡片、地点列表、2D/3D只显示当天；跨日衔接显示在交通/时间轴，全部视图画完整连接。3D局部索引映射到全局stop ID；选择其他天的地点会切到对应日。空日显示加入提示、隐藏旧当前地点，试走不越过当前选中日。编辑日选择和预览日选择独立，草稿只有提交后影响地图/导出。

W06验证：4项days定向测试、受影响W01身份/W04日历2项通过；重复到访新增后重跑首项通过。一次浏览器会话覆盖1280/390分日、预订、跨城/跨年、失败/接受未知/撤销、导出、重复到访/空日和2D/3D。实际本地HTTP，上游全部模拟，未真实联调、未部署、未更新ZIP；详细边界见AGENTS.md。

## W07：Web内部Agent与候选版本审查（当前）

网页生成使用`POST /api/agent-route {prompt,apiKey?,context?}`。结构化条件沿用W01规范，旧`/api/generate-route`保持W02流水线兼容。新接口只接受生成输入，不接收任意客户端route，不是对外MCP Server/App，也不是W08多轮会话接口。

- HTTP输入非法返回400 JSON；开始后200 `application/x-ndjson`/no-store，每行一个progress/result/error。progress含seq/tool/status/message/elapsedMs/usage；只有实际工具开始/结束时产生，不展示虚假百分比或模型思维链。result为`{type:'result',result:{route,source,poiSource,warning?,workflow,agent}}`。error用固定安全中文，不包含供应商响应或Key。断开响应连接触发取消；180秒总时限后终止，不返回未完成版本。
- `lib/web-agent.js`的`runAgent({seed,transport,decide,signal,emit})`可供后续内部服务复用，seed只能返回已构造/验证的可信行程。复用`editRoute`、`applySchedule`、`transportRequest/mergeTransport`，不用createItinerary重建已有实体。当前新生成中createItinerary仅初始调用。没有新数据库/持久任务/平行EditSession。
- 内部工具intent/propose/places/transport/schedule/reflect/edit/compare。先核对地点，再算道路和已知约束，有冲突才反思。模型只能从程序校验过的菜单选择actionId或stop，不接受模型坐标、营业时间、车次、URL或任意工具指令。菜单最多24项，当前支持可选点删减、当天前移、移日；不是自由工具Agent，不保证每种冲突都能自动修复。无Key走明确三城示例及程序选择，仍显示真实工具进度；模型/地点失败明确示例回退。
- `assertProtected`保留context、每天日期/时段/休息/住宿、已有visit/开放规则、locked身份及预订ID/日期/端点/缓冲。菜单禁止删减或移日有明确visit/锁定的点，允许当天排序；动作后仍复核所有保护字段。用户必须去/起点从意图已解析名称匹配为locked。预订不送道路工具，不能因删点或排序丢失预订；不靠忽略未知/用户规则制造“可行”。
- `agent={limits,usage,versions,selectedVersionId,reason,stopReason,trace,boundary}`；versions为`[{id,label,route,metrics,reason}]`，v0保留初始核对/交通/排程版，后续保存实际尝试候选。metrics含conflicts/unknowns/stops/unknownLegs，均来自当前排程/路段，不是LLM评分；每版保留实体ID、证据和revision。候选独立克隆，未改实体不重建。候选revision.reason=agent-candidate，parentRevision指计算基础版；不同分支数字可相同，以versions.id区分。
- 推荐判据：冲突数严格下降、未知/粗估交通数不增加、不出现原版之外的新冲突主体/代码。否则保留上一推荐版。删点损失在理由中明确，所有候选可供用户选用，不承诺全局最优。未知开放、估算交通、未核实预订不变为通过。当前版本指标可含默认停留等未知，不能单凭冲突0宣称可行。
- 硬上限每请求2轮/40次工具/48次外部网络/4次模型/180秒。模型max_tokens分别1000（意图）、4000（提案）、1000×2（反思），合计请求输出上限7000；上游输入仍计费，不是价格/总token上限。usage记录rounds/toolCalls/networkCalls/modelCalls/promptTokens/completionTokens/tokenUsageComplete；供应商没返回完整usage或调用失败，完整性为false，不按零费用算。无Key零模型调用完整性为true。浏览器后续照片/底图请求不计入Agent预算。
- `lib/agent-scope.js`用AsyncLocalStorage传递每请求signal/预算和model usage，未覆盖global.fetch。携程、通用POI、模型、交通适配器用scopedFetch：无Agent作用域时保留旧行为；作用域内组合取消信号与既有单次超时、计网络次数，持续保护响应体读取。并发请求预算独立，未读非200体取消释放，客户端取消后不得继续发出上游调用。
- 浏览器`requestAgent`处理跨UTF-8/JSON块及未完整返回，完成/失败/取消都不自动改地图。`agent-view`显示真进度、工具记录、调用上限/缺失Token提示及各版理由。采用前有未知/冲突须勾选确认；有手动编辑草稿时拒绝覆盖。采用是完整快照替换，沿用EditSession.draft/commit和20步撤销；revision递增，reason=agent-version-selection，旧交通请求失效，`transportReady:true`避免重复计算。重试复用上次prompt/context并读取最新Key。
- 详细工具记录与候选只保存在本次接口结果及页面内存；当前JSON导出为已采用行程，不包含完整Agent候选/trace。刷新不保留本次审查；W08/W12如需持久化应显式设计范围和脱敏。现在仍没有跨轮上下文、主动澄清或偏好记忆，W08接续。

W07验证：5项定向离线用例通过（包含实际本地HTTP及上游取消/并发预算隔离），一次1280/390浏览器会话覆盖进度/候选/采用确认/切换撤销/草稿保护/取消重试/导出，无额外采用交通请求、控制台0错误/警告。最后scope非200清理与usage字段完整性由定向scope/HTTP两项覆盖，未重开浏览器。未真实服务联调、未部署/刷新ZIP；详见AGENTS.md。

## W08：多轮、澄清与页面内偏好（当前）

`POST /api/agent-route` 保持旧 `{prompt,apiKey?,context?}` 兼容，网页普通提交新增 `conversation:{mode:'new'|'edit',preferences,changes,pending?}`；edit另传 `currentRoute`。表单明确条件只作用于new，edit以当前已提交行程为准，调整条件用本轮文字或原编辑器。三城按钮保留旧生成路径，作为无Key/服务失败时可直接使用的入口。

- `lib/conversation-route.js`提供可信输入边界。服务端生成/示例/候选响应的每站`placeProof`是HMAC签名的地点事实+证据；`planProof`签名原始标题、摘要、来源和提案历史。地点搜索结果也带placeProof，原编辑器新增/替换/重复到访时保留。签名密钥只在进程内存，不是用户Key；12小时到期，服务重启后失效。不建立服务端用户会话/数据库；签名证明由此服务输出过，不表示今天营业或导航可达，也不是用户身份认证。
- validateCurrent只接受v1、1–14天/2–50到访/N-1段，验证ID唯一、日序、路段邻接、revision；用户日期、visit、booking复用原规范化器。地点坐标、名称、链接、供应商开放描述和证据只取签名，忽略客户端伪造的同名字段；原始提案保留。停留/规则/锁定/日期/预订为用户输入，不升级为供应商事实。原ID和证据ID保留，重复到访有独立ID；reconcile维护跨日归属，不用createItinerary重建。
- 客户端道路/排程是派生数据，不在信任边界内；edit提交到服务端时清为空/unknown，再通过runAgent重算全部普通段。预订按normalizeBooking保留source:user、verifiedAt:null及空缓冲null；不送道路服务。修改前对照版的道路也保持unknown并明示，不能把它当已重算的导航结果。签名缺失、损坏、过期/服务重启返回400明确恢复提示；可继续本地手动编辑、新建，或重新检索地点；旧JSON导入不能绕过签名校验（W12需设计恢复/重新核对）。
- `lib/conversation-planner.js`在runAgent预算和取消作用域内增加一次conversation调用。仅缺决定性城市/对象不明确或条件冲突时问1个短问题；非必要信息可保持unknown。new把有限偏好、澄清前需求和本次要求交给模型，优先级为表单明确条件 > 本轮明确条件 > 页面保存偏好；edit带当前规范化结构和最近修改摘要，旧摘要不作为重复执行的动作。
- 用户授权动作由`lib/conversation.js`白名单投射：停留/休息、删点、当天前后移、移日、锁定、逐日日期/时段/休息、增天/删空天、逐段方式、步行预算、按名称城市检索加入/替换；单次最多8个。新地点必须服务端唯一匹配，同名/无匹配会澄清，用户也可原编辑器选点。模型坐标/开放规则/住宿事实/班次不执行。已有visit开放规则不因改停留而丢失；锁定点不删除/替换、不自动解锁；任何动作导致已有预订丢失则整次不返回候选，让用户先手动处理预订。复杂条件仍可用原编辑器。
- 用户明确动作先执行，再由W07保护菜单有限审查；自动修订仍不能改用户规则/预订/锁定，和本轮主动修改权限区分。原当前版`current`加入版本审查，`v0`标“本轮修改”，额外自动候选各自列理由。结果`conversation:{status:'candidate',mode,changes,base:{id,revision}}`；澄清为无route的`{conversation:{status:'clarify',question,pending:{request,question}}}`。agent-client接受两种结果，澄清不改变地图。
- W07仍为2轮/4次模型/40次工具/48次外部请求/180秒；有conversation的新生成最多1600+1000+4000+1000=7600请求输出Token，4次模型预算意味着有时只够1轮反思；edit最多1600+1000×2。旧入口7000不变。输出上限不是总Token/价格上限，失败/未返回完整usage仍不能当零费用。取消/超时继续传播上游。
- `ConversationState`只在当前页面内存存偏好（兴趣枚举、节奏、交通、步行预算）、当前结构化摘要、最近最多8条已采用变化（各160字）、一个待澄清请求（最多500字）与问题。没有无限消息历史/供应商报错/完整trace/候选堆积，不保存API Key。sk/Bearer片段脱敏。当前已提交路线每轮重新获取，未采用候选不是对话事实；手动提交/撤销后的路线才是下一轮依据。
- 偏好须用户主动选择并保存，可查看/编辑/清除；没有自动人群画像，不存老人/儿童/轮椅等条件。刷新或关闭页面清除对话与偏好。新建清空摘要/澄清/表单条件、保留用户主动保存的偏好和旧地图直到采用新版本；“清除对话摘要”保留当前行程/偏好，“清除全部偏好”保留当前行程。无账户同步或长期本机收藏，W12另做。
- 无Key时edit仅支持完整单条“第一站停留20分钟”/“删除第三站”等明确格式；否定句、多动作或不明确对象交还澄清/编辑器，不猜测。new无Key可用三城示例且明确不是定制结果。模型异常明确保留当前版并给重试/更新Key/手动编辑/三城路径。重试读最新Key和最新已提交行程。
- 候选采用复用EditSession和20步撤销、未知确认、transportReady；手动草稿阻止请求与采用。客户端额外记录请求开始时当前id/revision，若之后提交/撤销了行程，旧候选不能覆盖；同一审查面板主动采用后可再选另一版。成功候选会清除上次澄清/失败提示。JSON导出仍是已提交route，不含对话/偏好/Key；可包含签名依据，但它不是永久恢复凭据，分享/路书不应展示这些内部字段。

W08本地验证：4项定向测试通过；追加元数据签名与保留来源后仅重跑输入边界/HTTP两项通过；最后严格无Key语法由记忆/解析定向项覆盖。一轮浏览器1280/390完成多轮采用/澄清/偏好覆盖与清除/新建/草稿及旧候选保护/撤销导出/异常新Key重试/取消，发现并修复旧失败提示残留后只复验该路径及最终签名采用。控制台0错误/警告、手机无横溢。上游全模拟、未真实服务/部署/ZIP；详见AGENTS.md。

## W09：导航、途中发现与已游览记录

- `POST /api/places/nearby {city,origin:{lat,lng},radiusKm?,mode?}`：origin必须WGS84、radius默认2且0.2–8km、mode为walking/cycling/driving/taxi/transit。仅携程MCP真实query_ticket坐标查询，按供应方配置转换GCJ02，回到WGS84后过滤/排序，最多6点。输出`{source,provider,coordinateSystem:'wgs84',origin,radiusKm,mode,retrievedAt,pois,message}`；每个poi含`straightLineMeters,travel,placeProof`，travel复用W03完整分段结果。不支持通用旧POI或mock兜底；无配置503、失败502、空结果200/pois:[]。city用户填写非反向地理编码，票务景点不等于全量附近商户。
- 请求作用域最多7次外部调用（1地点、最多6道路），断连取消。直线只用于筛选，耗时来自道路模型或明确`estimated`与估算依据；公交不伪造道路结果。真实营业仍未知，服务签名不意味着实时认证。
- `public/coordinates.mjs`抽出原app地图函数，地图和`amapLink`同用WGS84→GCJ02。高德URI `coordinate=gaode`、坐标顺序lng,lat，名称URL编码。地点链接可带发现起点，分段链接固定行程两端；打车映射car，不下单；mixed未定默认walk并明示。最终高德道路/方式/入口需用户确认，本地无持续导航。
- 定位只由用户点击触发一次，默认浏览器标准WGS84；若设备提供已偏移坐标，可明确选GCJ02反算。定位拒绝/失败可从行程点手动选起点；城市可独立填写。坐标/精度只在导航面板内存，不入route/对话/偏好/JSON。发现起点只用于附近查询和前往链接，不更改计划的起终点。
- `stop.progress?: {completed:true,source:'user',schedule:{arrival,visitStart,visitEnd,departure,stayMinutes,restMinutes,waitMinutes,status:'unknown',timingBasis:'user-history',staySource:'user-history',openingSource:null,checks}}`。times沿用W04 stamp；normalizeProgress严格投射时刻/数值、固定unknown提示，不接受客户端任意check/来源/HTML。这是标记时的计划快照，不是实际到离记录或供应商事实。可随JSON导出；W10路书必须以“用户标记已游览/原计划”展示，不能冒充实走轨迹。
- `visited`编辑动作只允许标记下一个未完成站或撤回最后完成站；全行程completed必须前缀。动作沿同一EditSession提交和20步撤销。`protectHistory`拒绝修改已游览地点/所属日/顺序/visit/progress、当日date/window/rest、已完成路段方式和booking；重复到访清progress。可编辑其余未完成部分，不创建第二套行程状态。
- `applySchedule`对已完成站使用progress.schedule，不因交通刷新/新插入改变其计划，后续从该记录departure继续（为空仍未知）。普通交通请求和合并跳过已完成目的站；本地已算历史道路保持原值。多轮输入不信任客户端道路，历史段仍清unknown但不重查，progress白名单保留；这是用户记录而非签名交通事实。继续对话不得遗失完成状态，自动菜单仍经editRoute保护。
- `add-nearby`在editRoute内先复用add可信点/证据/ID规则，再在目标日未完成部分选择最小**直线增量**插入位置，保留其余点相对顺序，禁止切断预订/插进已完成之前；无合法位置报错。插入只生成草稿，提交才查受影响道路并重排时间；未知/粗估确认、失败恢复、撤销及版本保护沿W05。非全局路线最优，也不自动将发现位置加入路由。
- 导航面板identity为route.id/revision，提交/撤销/换路线清旧结果并中止请求；定位/查询/条件变化使用序号及AbortController，迟到结果不生效。有手动草稿或规划中禁止标记/加入。候选采用仍沿W08的uiBase保护。

W09验证：6项离线定向测试通过；一次1280/390浏览器会话及导出后真实本地HTTP多轮衔接通过。故意502仅产生预期网络错误，0警告，无脚本异常。手机无横溢，截图与导出在output/playwright/w09-*。所有上游模拟；未真实联调/实机高德唤起/部署/更新ZIP。细节见AGENTS.md。

## W10：公开行程文件与离线路书

- `public/portable-route.mjs`提供portableRoute/createPortable/parsePortable/safePublicUrl，公共格式为`{format:'citywalk-route',formatVersion:1,exportedAt,trust:'unsigned-readonly',imported,boundary,route}`。route仍schemaVersion:1；保留实体ID/revision、context、分日/地点/交通/排程/evidence和用户visit/booking/progress字段。只投射显式字段树，不复制整个对象后删Key；未知扩展字段、proposal完整候选、trace、原始image URL、fallbackPhoto、planProof/placeProof均不导出。context为本次条件，非页面已保存偏好。lodging/booking/progress属于公开快照内容，UI提醒预览。
- 原`exportButton`和路书JSON动作统一调用createPortable，不再输出内部签名。自由文字过滤sk-和Bearer样式凭据，外链只允许http(s)、无userinfo且不含token/key/auth/secret/signature/credential/proof参数；HTML显示全转义，内嵌JSON转义尖括号/分隔符。此规则不承诺自动识别任意个人信息；分享前用户需看本次备注。
- parsePortable支持此公开格式、历史`{route}`及裸v1；拒绝非JSON、未知格式版本、>8MiB、无效字段类型、ID/日归属/顺序/邻接和已游览前缀破坏，结构约束1–14天/2–50站/N-1段。通过仅证明可以作为只读路书数据，不核验文件事实、来源、时间或签名；旧文件即使有proof也丢弃。返回imported:true，页面显著提示文件未核实，绝不传给validateCurrent或替换state.route。恢复编辑/重查事实由W11复制与W12完整恢复另设计，不绕过W08。
- `roadbook.mjs`renderRoadbook再次投射输入，生成单文件HTML，按当前顺序与分日输出目录、空日、每站地点/来源/营业规则/计划时刻/冲突、入境交通/用户预订/未知缓冲及住宿备注。原summary/note标生成历史，不沿用生成时duration/distance为当前汇总。已游览只展示progress.schedule的原计划，非实际轨迹。天气/租赁事实未查询，准备清单是根据同行枚举、日期、方式与预算的通用规则建议，不是模型实时事实。
- 来源获取/供应方更新时间分别显示，导出时间不算核实时间；用户开放规则有recordedAt与有效期/依据，明确未独立核实；无值为未知。导航复用W09高德转换，需要网络，方式/入口需确认。路书无自动外部图片/字体/地图依赖，CSP default-src none、img data、内联固定样式/脚本；3D真实性继续说明。
- `roadbook-view.mjs`打开时克隆当前已提交全行程（不受分日地图筛选影响）；不包含未提交草稿或Agent候选。弹窗内current刷新回当前版，import只换独立预览，读取有序号与关闭取消保护，坏文件禁用下载/打印并可恢复。预览iframe允许同源打印/外链但不允许脚本；完整下载HTML含固定print/下载JSON按钮，打印样式A4，系统PDF由浏览器完成。
- 照片只复用storyboard已decode且canvas可读的图片转JPEG，最长840x520、每张600000字符、总5MiB以内，不额外抓图、不绕过CORS；离线保留内嵌图和出处，其余明确未嵌入。JSON不含图片字节/下载URL，只有归因。HTML、JSON、预览均无签名；本轮无行程存储/链接分享或永久恢复承诺。

W10验证：4项定向离线用例与一次1280/390浏览器会话通过，覆盖草稿隔离、只读导入/失败恢复/恶意内容、离线4图与JSON往返、打印调用和实际PDF输出。未系统打印/真实服务/部署/刷新ZIP；详细记录见AGENTS.md。


## W11：无服务端存储分享与重新核对副本

- `share.mjs`makeShareLink将W10 createPortable完整公开快照放入gzip envelope `{version:1,expiresAt:null|毫秒,packet}`，URL为`/share.html#cw1=<SHA256 of compressed bytes>.<base64url gzip>`；packet.id/revision等完整保留，重新导入只读且仍unsigned。fragment不随HTTP送服务端。SHA只校验损坏，任何人可改写后重算，不证明作者。最大链接60000字符/原文512KiB、流式解压限额；超限提示JSON/HTML替代，不丢道路数据来伪称相同版本。现代CompressionStream/DecompressionStream与crypto.subtle需要支持，HTTPS或localhost。
- 独立share.html不启动app地图或接口，不依赖存储；安全iframe renderRoadbook全部文字转义、无脚本。打开错误禁下载/复制，缺失、截断、校验损坏、格式/结构错误、过期、能力不支持明确提示。约定有效期0/7/30天仅网页检查，可绕过且不能远程撤回；不承诺短链、保密或永久服务。完整链接过长可能被聊天软件截断，保存JSON/HTML兜底。服务器磁盘更换不影响URL内容；网站停止提供页面则无法在线读。
- 发送者分享按钮先固定已提交全版本并预览，勾选检查公开内容才生成；未提交草稿/候选不参与。本次同行、住宿、预订、已游览可出现在快照中，提醒检查个人信息；原Key/对话/保存偏好/GPS/proof依W10白名单排除。剪贴板失败可选中手动复制，不依赖浏览器存储。
- `copyIntent`只发地点全名/城市/地址线索、按日索引/日期/时段/休息、visit停留/休息、locked、方式/预算；服务端`POST /api/share/copy`再次投射白名单并规范化，不接收整个URL路线。1–14天/2–50站，最多3并发/50外部请求/120秒、断连取消。逐点重新匹配真实携程/通用适配器POI；所有点须唯一，不能唯一422、无真实配置503、上游失败502、输入非法400、取消408。不mock、不部分替换，不信任输入坐标、供应商来源、营业、URL或签名。
- 全部匹配后createItinerary新建所有行程/日/站/段/证据ID与revision=1，source=`shared-copy`、poiSource=ctrip；原summary/note/标题等自由文字丢弃，生成固定说明。副本保留请求日序/日期/时段/停留/休息/锁定/交通预算，清除作者同行/住宿/预订/已游览/自填营业规则；不作为W12完整恢复接口。道路全部unknown，排程重新应用，采用后浏览器请求交通。重新查询的地点证据由服务端sealRoute新签名，不签URL原事实；12小时/重启失效及非实时认证边界不变。validateCurrent可接受新签名并继续多轮，不使用任意URL为可信输入。
- share-view打开原件与候选独立预览，复制须主动点击；新副本结果不自动替换当前地图，明确接受未知并采用才提交EditSession。draft/busy/旧base拒绝采用，取消/关闭/换hash序号拒迟到结果；采用清旧对话摘要/候选，本人已存偏好仍依W08。跨行程采用保留会话撤销历史；undo恢复旧id时，以该行程原revision+1而非副本版本号递增。

W11验证：4项离线定向通过；来源分支细改只重跑受影响复制一项。一次1280/390浏览器会话及定点补验覆盖链接完整快照、新context/禁存储、剪贴板回退、复制失败/取消/重试/采用/undo、错误链接和手机布局。未真实服务联调、未部署或更新ZIP。详细结果见AGENTS.md。

## W12：本机收藏、历史与完整恢复

- `public/library.mjs` 使用 IndexedDB `citywalk-library`、数据库版本1、`trips` store。每个收藏独立ID/name/schemaVersion:1/updatedAt，versions存独立保存ID、北京时间展示的savedAt、W10公开packet和白名单JPEG照片。主动保存当前已提交版本，草稿/候选不入库；无自动保存、账户、服务器磁盘或跨设备同步。每个收藏保留最近20次、24 MiB；超限报错，可删除单个历史版本。IndexedDB读改写在单个readwrite事务内，跨标签并发不丢更新；失败/配额不足原子回滚。
- 收藏可命名/改名、按名称/城市/地点检索、删除、选择历史、恢复历史为新的最新保存、重开、导出某版JSON/HTML、导出单收藏历史或全部库。备份格式`{format:'citywalk-library',version:1,exportedAt,records}`，最大64 MiB、导入1–100收藏/各20版本；逐条投射验证，全部通过才一次事务加入。导入生成新的收藏/保存ID，不覆盖原库；原行程ID/分日/用户数据保留。也兼容W10公开JSON和旧v1文件。未来数据库版本不自动清库，格式不兼容明确拒绝，未实现未知未来格式转换。
- 存储不含Key/对话/页面保存偏好/GPS/proof；本次同行、住宿、预订、开放规则、已游览仍保存。图片只复用已加载、可canvas读取JPEG，每张600000字符/总5 MiB。备份无加密，脱敏不保证任意个人信息识别。禁存储、配额、坏文件、空列表、零搜索结果、版本不存在都有反馈及导出/重试路径。
- `localRoute`重新经过parsePortable并去签名，强制添加`restoration:{status:'unverified-local',restoredAt}`（纳入公开白名单）。在当前页重开沿`EditSession.restoreSnapshot`保存上一版用于撤销，不重新计算存储的道路/计划；缺计划才补排程。用户后续编辑/交通重算可更新派生计划，但未核实标记仍保留。保留本人日期、分日、visit/openingRules/booking/progress及原计划；主页面明显标“本机恢复·未核实”，继续多轮在UI阻止，服务端无proof同样拒绝。没有伪造长期可信恢复。
- `POST /api/library/recheck`接收copyIntent的名称/城市/地址线索/日序等，另含本次context、每天lodging、各站visit/progress、各段bookings；不接收本地坐标/道路/链接事实。复用W11逐点唯一真实匹配、3并发/50查询/120秒/断连取消，全部匹配后创建新服务身份/source:`local-rechecked`。保留规范化的个人条件/记录；旧标题/摘要等自由说明不签为事实，改为固定重核说明。只签新查询的地点证据，再validateCurrent规范化个人字段和清空道路。用户预订source:user/verifiedAt:null，已游览仍user-history，非实际轨迹。新身份不覆盖收藏中的原ID。
- 重核结果独立预览，需“接受未知并采用”才替换地图；采用后交通重算，原版可撤销，收藏须主动保存才更新。草稿/繁忙/已改变base阻止采用，取消/关闭/选择版本使旧结果失效；失败保留收藏和当前行程。重新核对不调用AI重写计划，服务签名仍12小时/重启失效、非实时认证。
- `library.html`为独立离线行程库，仅加载路书/存储模块，不启动地图/模型/地点/照片查询。`library-sw.js`只缓存明确的本机库静态模块白名单，绝不缓存API/密钥/地图瓦片。首次打开收藏时注册，需要HTTPS或localhost；缓存准备失败或超时建议下载HTML。无网访问主页会退到本机库，断网刷新可读本机路书及嵌入照片并导出；离线不能地图编辑/生成/在线导航。主页面断网提示且拦外链，独立预览iframe禁脚本/外部弹窗；下载HTML的导航仍需联网。
- 数据范围是同设备/浏览器/网站origin（协议、主机、端口）；无痕退出、清网站数据、浏览器回收、换地址或设备会不可见/丢失。缓存与IndexedDB不是永久保障，下载HTML/JSON备份是兜底。静态模块改动时需更新`library-sw.js`的CACHE版本，以免在线主页面和离线库混用旧模块。

W12验证：3项定向离线测试覆盖完整个人快照/历史/备份/去签名、新查询事实隔离与个人记录保留、失败/取消及真实本地HTTP重核→多轮；URL尾斜杠断言修正后只重跑相应一项通过。一次1280/390浏览器会话覆盖收藏/改名/检索/历史恢复/备份往返/删除/配额回滚、未核实重开与多轮拦截、重核候选/采用/撤销、禁存储、并发保存、失败取消和草稿保护，离线刷新/主页回落/返回联网重开。外链冒泡被原图链接拦截的问题已改捕获阶段并定点复验。上游全部模拟，未部署或更新ZIP。
