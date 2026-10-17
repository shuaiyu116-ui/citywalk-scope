# 携程 MCP 接入

依据：用户提供的《MCP使用文档.pdf》，2026-10-16 已完成真实服务认证、tools/list 与 query_ticket 调用。

## 配置

- 地址固定为 `https://u.ctrip.com/faas/mcp`。
- `CTRIP_MCP_TOKEN`：服务端 Bearer Token。手册不要求额外两个数字 ID；本次认证与查询无需它们。
- 默认采用手册的直接 HTTP 方式，不需要初始化会话。
- 请求使用 `Content-Type: application/json`、`Accept: application/json, text/event-stream` 和 Authorization。
- 返回支持 JSON 或 SSE，取匹配请求 ID 的 `result.content[].text` 并解析 JSON 数组。
- 真实 Token 仅存本地被忽略的 `.env` 或 Render 环境变量，不放入分享包、日志、网页或文档。

## 业务流程

W02：DeepSeek 解析需求 → AI 先提出主选/备选与理由 → 逐站 `query_ticket`（cityName、scenicSpotName、resourceSize=1）→ 按名称、城市、地址线索与唯一身份匹配 → 仅已匹配 POI 落图。模型不提供可信坐标、开放时间或价格。

`searchMcpPois({city, matchTarget:{name,city,addressHint}})` 进入 identity 查询，跳过附近补查及步行半径；兼容内部 `placeName/matchMode:'identity'`。同名保留供 matcher 判别，异城与非法坐标在适配器过滤。最多 8 主选/8 备选，三并发；重复城市/名称请求共享结果。单点错误保留 service_error，不静默降为 mock。

旧 `/api/ctrip/pois` 入口未传 matchTarget 时保持附近查询；intent.context 为非步行或多日时保留同城候选，不应用步行范围限制。前端此按钮用当前选中站点的城市，避免把多城标题当作一个城市。

`resourceSize` 是每个景点的票务商品数量，不是景点数量。适配器不把讲解票价当作景点门票价格，也不执行预订或购买。景点详情链接保留接口返回地址。

仅旧步行附近入口：附近范围默认 4 km，有 maxWalkKm 时参考该值（1–8 km）。这只是候选范围筛选；模型仍负责游览取舍，最终里程以步行路由返回为准。

## 已验证的响应字段

| MCP 字段 | 项目字段 |
| --- | --- |
| additionalInfo.poiId | id（ctrip- 前缀） |
| basicInfo.name / cityName / address | name、城市过滤、address |
| additionalInfo.coordinate.lat/lng | location |
| additionalInfo.addTags | type |
| additionalInfo.pmRecommand / introduce | note（去除 HTML） |
| basicInfo.imageURL | image |
| urlInfo.h5Url / pcUrl | detailUrl、imagePageUrl |

手册未声明坐标系。真实武康大楼样本为 (31.2044589, 121.4382306)，转换后约为 WGS84 (31.2063272, 121.4336076)，与已有地图参考点相距约 14 米，而不是未经转换时的数百米偏移。因此默认按 GCJ-02 转换，避免前端再次加偏。此判断基于样本核对，供应方确认不同坐标系时可通过 `CTRIP_MCP_COORDINATE_SYSTEM` 调整。

## 兼容性与失败处理

`/api/ctrip/pois` 路径、旧通用 Bearer JSON 适配器及三城示例保留。MCP Token 优先；配置后认证失败不会静默改用旧接口。旧生成接口保留历史示例回退；网页Agent生成失败明确报错并保留当前行程，不回退示例。附近补充查询失败但初次查询成功时，可继续使用真实初次结果并显示提示。

浏览器只调用项目自己的后端；共享携程 Token 与每位用户输入的 DeepSeek Key 独立。三城演示无需 DeepSeek Key；真实 AI 编排仍需有效 DeepSeek Key。

## W02 来源证据与验证

每个 POI 返回 city、source=ctrip、provider=ctrip-mcp、retrievedAt（实际请求返回时刻）。providerUpdatedAt=null，未从目前文档/响应中取得可核实的供应商更新时间。openingHours 返回 status=unknown、text/source/url/retrievedAt/providerUpdatedAt/verifiedAt 均 null；available 及商品介绍、票价不用于推断营业。调用成功与身份匹配也不是出行当天开放验证。

2026-10-16：本轮 MCP 定向测试 8 项通过（模拟 JSON/SSE 等）；新增 identity 断言覆盖同名/远点保留和异城过滤，之后仅复测受影响 identity 用例。W02 流程测试覆盖 matchTarget、非步行/多日不按半径过滤与本地 HTTP 模拟 MCP。真实服务未重测，部署未更新。

## 2026-10-17 酒店查询

已通过真实 `tools/list` 与 `query_hotel` 返回字段核对，实现在 `lib/ctrip-hotels.js`。DS根据用户需求与已规划地点决定是否查酒店、查询城市和区域，再由服务端查询真实候选。

查询白名单：`cityName`、`landmarkName`、`hotelName`、`checkInDate`、`checkOutDate`、`maxPrice`、`tags`、`stars`、`sortType`。`tags`会覆盖地标条件，有明确地标/酒店名称时不同时发送标签。入住日期只取明确用户/行程输入，无日期的参考起价单独标注。房间及入住人数保留偏好但不发送给此MCP工具。

酒店ID来自 `basicInfo.productID`（兼容产品顶层ID）；名称、城市、地址、图片、参考起价、含税标志、评分分别来自 `basicInfo`，坐标、星级、区域及介绍来自 `additionalInfo`，详情链接来自 `urlInfo`。仅保留同城且符合已知预算的候选，不把无价酒店说成符合预算。复用景点坐标系配置；公开坐标统一WGS84。

真实DS→携程查询上海静安寺酒店成功，返回2家候选；6项酒店定向测试通过。酒店选择仅是本行程记录，可撤销，不预订或付款。详细验证及边界见 [旅行路书与酒店选择](旅行路书与酒店选择-2026-10-17.md)。
