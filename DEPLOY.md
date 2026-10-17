# 部署与环境配置

必须部署完整 Node Web 服务，不能只上传 `public/`。页面与 `/api/*` 同源，保留 `/share.html`、`/library.html` 和 `/library-sw.js`。2026-10-16 W14 未推送 GitHub、未触发 Render、未构建 Docker 镜像、未做真实服务联调。历史网址 <https://citywalk-scope.onrender.com> 最新代码和环境未确认。本地目录历史已确认非 Git 仓库，ZIP 不含 remote/提交历史。

## 环境变量

建议 Node.js 22 LTS，最低 18；Render Blueprint 与 Dockerfile 使用 Node 22。新开发环境 `npm ci`，启动 `npm start`；已有依赖无需重复安装。

| 变量 | 默认与用途 |
| --- | --- |
| `PORT` | 默认 3000，托管平台注入；临时测试可设 0 |
| `CTRIP_MCP_TOKEN` | 服务端 Bearer Token；真实携程地点、附近发现、分享复制/本机重核；优先于旧 POI 配置 |
| `CTRIP_MCP_COORDINATE_SYSTEM` | 默认 `gcj02` 转 WGS84；仅供应方证实为 WGS84 时改 `wgs84` |
| `DEEPSEEK_API_KEY` | 可选服务器默认 Key，网页个人 Key 优先，无需统一提供 |
| `DEEPSEEK_API_URL` | 可选模型兼容端点，默认 DeepSeek 官方 Chat Completions；生产不填测试端点 |
| `TRANSPORT_ROUTER_URL` | 全方式 Valhalla 兼容服务 route URL；未配置使用公共 Valhalla |
| `WALKING_ROUTER_URL` | 旧步行覆盖；新接口仅步行且未配置全方式 URL 时使用，不冒充机动车路线 |
| `CTRIP_API_BASE_URL` / `CTRIP_API_KEY` | 仅无 MCP Token 时使用的旧 HTTP POI 适配器，不必同时配置 |
| `MAPILLARY_ACCESS_TOKEN` | 可选旧图片路径，Mapillary 优先/Commons 回退；空值默认百度，真实 Token 联调未确认 |

无 Key 可演示三城，但地图/图片/道路仍可能联网。MCP 认证失败不会静默改走旧 HTTP；附近、重核/复制失败不用 mock 冒充。生成失败可能返回带 warning 的示例，应核对来源而不是只看状态码。

本地复制 `.env.example` 为 `.env` 私下填空值；进程环境优先，已存在的空环境变量也不被文件覆盖。托管用 Environment；实际 `.env` 不进入上传目录、构建上下文或 ZIP。个人 Key 会经过部署服务器，应仅在可信站点输入。

## Render

1. 解压 ZIP，将内层 `CitywalkScope/` 作为项目根目录（package.json、server.js、render.yaml 同层），上传到你掌握的 GitHub 仓库。不要上传 ZIP、解压验证目录、真实 .env 或旧 output。当前本地没有可自动推送的 remote。
2. 新服务用 **New → Blueprint** 连接仓库；现有服务更新对应仓库分支。配置为 `npm ci` / `npm start`，健康检查 `/`，Node 22。免费计划与休眠规则以账户界面为准。
3. 在 Environment 私下配置 MCP Token 和可选项；个人 DeepSeek Key 可仅由网页使用者输入。
4. Live 后执行下方真实验收，再宣布新版上线。`/` 健康只证明 HTTP 页面能返回，不证明上游成功。

## Docker 与服务器

在干净解压目录运行：

```bash
docker build -t citywalk-scope:w14 .
docker run --rm -p 3000:3000 --env-file /private/citywalk.env citywalk-scope:w14
```

配置文件由部署方私下创建，不在交付包中。`.dockerignore` 排除真实 .env、日志、output、Git 和 node_modules。镜像本轮未构建，端口、镜像下载、出站网络需部署时验证。国内服务器也可直接运行 Node，由进程管理器保持服务，再配置 HTTPS 反向代理。

Agent 使用 NDJSON 流，代理关闭缓冲、允许约 240 秒读取并正确传递断连。例如 Nginx：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_read_timeout 240s;
}
```

证书/域名另行配置，不记录请求体或 Authorization。每请求 Agent 预算不等于账户配额或全站限流；长期公开运营的访问控制、用量管理与监控需另行配置。

## 浏览器与数据

- 分享压缩、剪贴板、定位和 Service Worker 依赖现代浏览器及权限，使用 HTTPS 或 localhost。局域网 HTTP 不是 localhost，可能缺少分享/离线能力；剪贴板失败可手动复制。
- 分享 URL 的 `#cw1=...` 携带完整快照，服务器不存行程；不能删片段或截断，不是短链/永久链接。约定有效期不是访问控制。
- 收藏 IndexedDB 限同设备/浏览器/origin（含端口）；换域名端口不会自动迁移，清理/回收可丢失，迁移前导出库备份。
- 首次联网打开收藏完成缓存后，断网 `/library.html` 可读路书，不可规划/导航。当前缓存 `citywalk-library-shell-v1.2`；修改缓存模块须升版本，不要在代理长期锁死 library-sw.js。
- 服务签名 12 小时或重启失效。本机恢复仍保留用户记录，可信多轮需重新核对。多实例没有共享签名密钥，可能跨实例校验失败；Demo 优先单实例，扩容前需设计共享信任机制。

## 上线前尚需的一次真实验收

以下为部署方待执行，不是本轮通过记录：

1. 用评委实际网络打开 HTTPS 首页/分享/收藏，确认版本、静态模块、代理流式进度与取消断连。
2. 用有效个人 DeepSeek Key 和 MCP Token 生成指定城市路线；核对 source、poiSource、逐站证据、携程详情及回退提示。配置成功/HTTP 200 不能替代此项。
3. 核实步行/骑行/机动车道路与失败状态，以及高德底图、百度代理、携程图片可达性及授权。默认 Valhalla 位于海外。
4. 真手机验证定位授权/拒绝、高德跳转和最终方式；新浏览器打开完整分享，重核复制/本人重核后继续修改；验证新域名首次准备后的离线库和备份。
5. 天气、实时营业、租赁、车次住宿未自动查询，继续标未知或用户提供，不把建议当实时承诺。

不因纯文档或交付整理重跑全套历史测试。真实验收失败时，按失败模块定向处理并记录原因。
