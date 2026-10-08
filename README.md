# Citywalk Scope

“立大功汪汪队”携程黑客松自由探索赛道 Demo：用自然语言生成路线，并用横向故事卡和 2D/3D 空间预览完成一次 Citywalk 试走。

## 启动

需要 Node.js 18+（服务端使用原生 `fetch`）：

```bash
npm install
npm start
```

打开 <http://localhost:3000>。演示时也可以指定端口：

```powershell
$env:PORT='3199'
node server.js
```

## 公网部署

评委需要通过网址访问时，请部署整个 Node 服务，不能只部署 `public/` 静态文件。项目已提供 Render Blueprint、Dockerfile 和完整步骤，详见 [公网部署说明](DEPLOY.md)。部署平台会自动注入 `PORT`，页面和 `/api/*` 接口会共用同一个公网地址。

## 真实工作流

配置 DeepSeek Key 后，`POST /api/generate-route` 按下面顺序执行：

1. DeepSeek 解析城市、兴趣、起点、时长、步行距离和限制条件。
2. 服务端查询携程 POI；当前未配置携程接口时使用本地北京、上海、南京 POI 适配回退，并在界面标注来源。
3. DeepSeek 只从返回的候选 POI 中编排步行顺序和空间叙事。服务端校验每站的 POI ID，名称和坐标采用 POI 数据；少于两个有效候选、接口失败或模型返回未知地点时，明确回退到用户输入城市的示例路线，不继续编造地点。
4. 服务端按 POI 坐标检索可授权的位置附近图片；没有可靠图片时，卡片显示占位，不把预设图称为街景。
5. 前端请求 Valhalla 公共步行路由，把真实道路几何显示在 2D 地图和 3D 空间示意中，公里数取自道路路径；服务不可用时显示标注过的虚线点位连线。公共服务不承诺可用性，演示前需确认网络；可通过 `WALKING_ROUTER_URL` 切换自有 Valhalla 服务。

Key 可以在页面右上角“连接设置”输入，只保存在当前标签页的 `sessionStorage`，由本机服务转发至 DeepSeek，不写入项目文件。

## Demo 能力

- 2D 视图使用 Leaflet 和高德地图国内底图，显示可点击的路线点位。路线坐标在服务端保持 WGS84，浏览器绘图时转换为高德所需的 GCJ-02，评委无需代理即可看到国内地图。
- 3D 视图使用 Three.js 在本地根据路线、地点类型和稳定种子实时生成建筑、树木、道路、地标和移动试走光点。这是空间比例和路线关系示意，不是真实建筑 BIM 或街景重建。
- 横向故事卡支持点击跳转、上一站/下一站和“自动试走”；路线可导出为 `citywalk-route.json`。
- 演示路线先用 `public/assets/` 的参考图保证首屏稳定，并带来源说明；随后服务端通过百度图片搜索按城市和地点检索结果，浏览器经同源 `/api/location-photo` 代理补充图片。自定义路线也采用同样策略，找不到可用结果时显示“暂无授权位置照片”。

输入框下方提供“北京 · 胡同人文”“上海 · 梧桐街区”“南京 · 秦淮旧城”三个示例按钮，点击即可直接生成对应的本地演示路线。

## 携程 POI 适配入口

已检索携程开放平台和官方玩乐平台文档。公开可确认的电子导游接口面向供应商景点/内容同步，无法直接当作通用城市 POI 搜索。具体检索依据见 [携程接口调研](docs/ctrip-api-research.md)。当前适配器属于本项目内部契约，拿到比赛方或携程提供的 POI 产品文档、签名方式和授权后，在服务端配置：

```powershell
$env:CTRIP_API_BASE_URL='https://your-ctrip-endpoint.example/pois'
$env:CTRIP_API_KEY='your-server-side-key'
node server.js
```

当前适配器发送的内部请求契约是：

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

适配器兼容 `数组`、`{ "pois": [] }`、`{ "data": { "pois": [] } }` 和 `{ "data": { "items": [] } }` 响应。每个 POI 至少需要名称和坐标，坐标可写成 `location: { lat, lng }` 或直接放在 `lat/lng`、`latitude/longitude`；可选字段包括 `id`、`type/category`、`note/description`、`image/imageUrl/photoUrl` 和图片来源字段。真实携程接口通常还需要专用签名、请求头、分页或产品线字段，这些必须按携程给出的正式协议替换 `searchCtripPois` 中的通用 Bearer JSON 请求。

## 图片和街景边界

没有携程图片授权时，服务端和浏览器默认使用百度图片搜索作为国内网络可用的地点照片来源。服务端通过 `GET /api/location-photo?city=北京&name=天安门广场` 提供搜索代理；百度缩略图文件也通过 `/api/location-photo/image?url=...` 同源转发，浏览器不再直接请求百度图片域名，减少防盗链和浏览器拦截造成的加载失败。图片代理仅允许百度缩略图域名，校验实际图片格式，并限制超时、大小和缓存。卡片显示“百度图片搜索结果（请核对授权）”提示，正式发布前应核对图片授权。上海示例的远程图片加载失败时回退到项目内对应的本地参考照片，同时更新来源标注；其他路线没有匹配的本地照片时显示占位。

如已获得 Mapillary 使用许可，可在服务端配置 `MAPILLARY_ACCESS_TOKEN`。配置后 `lib/location-images.js` 会保留旧的 Mapillary 优先、Commons 回退路径；未配置 token 时使用百度图片。Mapillary、Commons 和百度图片均需要按实际发布场景核对授权，百度/高德街景等服务也需要各自的 API Key 和许可。

```powershell
$env:MAPILLARY_ACCESS_TOKEN='your-mapillary-client-token'
node server.js
```

该可选入口遵循 [Mapillary API v4](https://www.mapillary.com/developer/api-documentation/) 与 [图片署名规则](https://help.mapillary.com/hc/en-us/articles/115001770409-CC-BY-SA-license-for-open-data)，请求附近图片的位置、缩略图、拍摄时间和作者。Token 仅在服务端使用。已验证本地响应解析和失败回退，尚未使用真实 Token 联调；部分中国城市可能没有街景覆盖。

高德底图使用 GCJ-02 展示坐标；正式接入携程时需按文档确认 POI 坐标系，并继续在适配层统一转换，避免 GCJ-02 等坐标混用。步行道路几何仍可通过 `WALKING_ROUTER_URL` 接入自有 Valhalla 服务；公共 Valhalla 不可用时界面保留点位连线。

## 主要接口

- `POST /api/generate-route`：DeepSeek 意图解析、POI 查询和路线生成。
- `POST /api/ctrip/pois`：单独测试携程 POI 适配入口。
- `POST /api/walking-route`：将 `points: [[lat, lng], ...]` 转换为步行道路几何。
- `GET /api/demo-route?city=北京|上海|南京`：获取不依赖 Key 的本地城市演示路线（省略 `city` 时默认为上海）。
- `GET /api/location-photo?city=北京&name=天安门广场`：通过服务端调用百度图片搜索并返回单张候选图片；搜索失败时返回 `{ "photo": null }`。
- `GET /api/location-photo/image?url=...`：同源转发百度缩略图文件，保留图片来源链接。

## 主要文件

- `server.js`：静态文件服务、DeepSeek 调用、路线归一化、携程 POI 适配和步行路径代理。
- `public/app.js`：路线生成、故事卡、Leaflet 2D 地图、设置和导出交互。
- `public/scene3d.js`：Three.js 本地程序化 3D 场景、点位选择和动画试走。
- `lib/location-images.js`：服务端位置图片检索缓存。
- `lib/location-photo-proxy.js`：百度缩略图文件转发、格式校验和内存缓存。
- `public/location-photos.mjs`：浏览器与服务端共用的地理图片查询、距离排序与归因。
- `public/assets/ASSETS.md`：本地参考图片的来源与授权说明。

`npm test` 验证照片筛选、距离排序、来源与归因字段、Mapillary 的兼容解析和失败回退，以及图片文件转发的缓存、域名限制和失败处理；实际 DeepSeek 调用需要自己的有效 Key，携程正式联调还需要比赛方提供接口权限。
