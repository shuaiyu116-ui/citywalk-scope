# 携程接口调研记录

> 2026-10-16 更新：已收到比赛方 MCP 文档并完成真实接口接入，当前实现见 [MCP 接入说明](ctrip-mcp.md)。以下内容保留为早期公开接口调研记录。

这份记录只保留当前可以从公开页面确认的资料，用来说明 Demo 的携程 POI 接入边界。比赛方或携程提供正式的 POI 产品文档后，再把服务端适配器中的请求签名、字段映射和错误码替换为正式协议。

## 已确认的公开入口

- [在线导游信息查询接口](https://ttdstp.ctrip.com/apiplatform/api/onlineguideinfoquery.do)
- [在线导游站点信息同步接口](https://ttdstp.ctrip.com/apiplatform/api/onlineguidesiteinfosync.do)

从接口名称和公开说明可以确认，这组入口面向供应商电子导游/景点内容同步。它们不能被可靠地推断为面向任意城市关键词搜索的通用 POI API，也没有足够公开字段可以在本项目中伪造一个“官方 POI 搜索协议”。

上述 URL 是官方文档页面，不应直接视为可调用的生产服务地址。本次公开检索未查到可以完整验证的城市 POI 搜索产品协议；这不代表携程不存在该产品，而是正式 endpoint、权限和字段仍需由比赛方或合作方提供。

### 可公开确认的参数

在线导游信息查询文档的参数表列出了以下字段：

| 位置 | 字段 | 含义 |
| --- | --- | --- |
| 请求鉴权 | `accountId` | 携程分配的供应商帐号 |
| 请求鉴权 | `serviceName` | 此产品为 `GuideContentQuery` |
| 请求鉴权 | `requestTime` | `yyyy-MM-dd HH:mm:ss` 格式的请求时间 |
| 请求鉴权 | `version`、`sign` | 版本 `1.0` 与签名；不能据此推断其他产品的签名算法 |
| 请求业务参数 | `sequenceId` | 处理批次流水号 |
| 请求业务参数 | `supplierScenicId` | 供应商景点 ID |
| 响应 | `resultCode`、`resultMessage` | 结果码与说明，文档示例 `0000` 表示成功 |
| 响应 | `supplierScenicId`、`items` | 景点 ID 与电子导游内容节点数组 |
| 内容节点 | `guideContentId`、`geohash.latitude`、`geohash.longitude` | 导游内容 ID 和地理位置 |

站点同步文档使用 `GuideScenicModify`，并说明 `otaScenicId`（携程景点/POI ID）暂由携程线下提供。它以已知景点 ID 同步内容，无法替代“城市 + 兴趣 + 步行范围 → 候选地点”的检索请求。以上字段仅用于记录公开研究依据，未把该供应商产品拼接为本项目的 POI 搜索接口。

## Demo 适配边界

项目把携程调用封装在 `server.js` 的 `searchCtripPois` 中。配置 `CTRIP_API_BASE_URL` 和服务端 `CTRIP_API_KEY` 后，当前代码发送一个内部适配请求：

```json
{
  "query": "用户原始路线描述",
  "city": "上海",
  "intent": {
    "interests": ["梧桐", "老洋房"],
    "durationMinutes": 120,
    "maxWalkKm": 3
  }
}
```

响应适配器暂时接受以下常见外层结构：

- POI 数组
- `{ "pois": [] }`
- `{ "data": { "pois": [] } }`
- `{ "data": { "items": [] } }`

每个地点至少需要名称和经纬度。适配层支持 `location: { lat, lng }`，或直接使用 `lat/lng`、`latitude/longitude`；`id`、类型、描述和图片字段是可选的。以上是项目内部契约，不是对携程正式协议的声明。

内部响应示例：

```json
{
  "pois": [
    {
      "id": "example-poi-1",
      "name": "武康大楼",
      "type": "城市地标",
      "location": { "lat": 31.2062561, "lng": 121.4337292 },
      "description": "本地示例描述",
      "imageUrl": "https://example.com/licensed-photo.jpg",
      "imageSource": "图片提供方与许可说明"
    }
  ]
}
```

## 联调时需要向接口提供方确认

1. 正式的 POI 搜索/推荐产品入口、HTTP 方法、鉴权签名和必填请求头。
2. 城市、关键词、分类、分页、排序和步行范围字段的准确名称与取值。
3. POI 唯一 ID、名称、WGS84/GCJ-02 坐标、类型、描述、图片和版权字段的返回位置。
4. 频率限制、错误码、缓存要求以及图片和地点内容的展示授权。

拿到这些资料后，只需要替换 `searchCtripPois` 的请求构造和 `normalizePoi` 字段映射；DeepSeek 的候选 POI 约束、路线校验、2D/3D 展示和真实步行路径逻辑可以保持不变。

