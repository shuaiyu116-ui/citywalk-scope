# 公网部署

这个项目是一个 Node Web 服务，必须部署整个项目，不能只把 `public/` 上传到静态网页托管。评委打开平台生成的 URL 后，页面和 `/api/*` 接口会由同一个服务提供。

## 推荐方式：Render

Render 适合快速生成一个可分享的 HTTPS 地址，项目已经包含 `render.yaml`：

1. 把项目上传到 GitHub 仓库。不要上传 `node_modules/`、`.env` 或私人 API Key。
2. 在 Render 选择 **New > Blueprint**，连接这个仓库并选择项目根目录。
3. Render 会读取 `render.yaml`，使用 `npm ci` 构建并使用 `npm start` 启动。
4. 部署完成后，Render 会生成类似 `https://citywalk-scope.onrender.com` 的地址，把这个地址发给评委即可。

首次访问免费实例可能需要等待几十秒唤醒。评委打开根地址即可进入页面；健康检查地址是 `/`。

## 必需的环境变量

不配置任何 Key 也可以演示北京、上海、南京三个本地示例路线。需要真实能力时，在平台的 Environment 中配置：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 服务端默认使用的 DeepSeek Key；也可以只在页面“连接设置”中临时输入 |
| `CTRIP_API_BASE_URL` | 携程 POI 服务地址 |
| `CTRIP_API_KEY` | 携程 POI 服务端 Key |
| `WALKING_ROUTER_URL` | 可选，自有 Valhalla 步行路由服务地址 |
| `MAPILLARY_ACCESS_TOKEN` | 可选，获得授权时启用位置照片检索 |

私人 Key 只配置在托管平台环境变量中，不要写入前端文件、README 或 Git 历史。

## 国内云服务器方式

如果评委网络对海外托管平台访问不稳定，可以把同一个仓库部署到国内云服务器（腾讯云、阿里云、华为云均可）：

```bash
git clone <仓库地址>
cd <项目目录>
npm ci
PORT=3000 npm start
```

再用 Nginx 将 80/443 反向代理到 `127.0.0.1:3000`，绑定域名并配置 HTTPS。项目也提供了 `Dockerfile`，支持有容器服务的国内平台直接构建。

## 本地检查

```bash
npm ci
npm test
node --check server.js
npm start
```

浏览器打开 `http://localhost:3000`。公网平台会自动注入 `PORT`，服务已兼容这个端口，不要把端口写死。

