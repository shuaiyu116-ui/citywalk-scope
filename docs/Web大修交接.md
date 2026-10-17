# Web 大修 · 最终交付

> 2026-10-17 新增试用问题修复：当前源码已超过W14交付包。澄清记忆、错误反馈、AI真实候选判同与前端信息层级已修复；真实杭州6天8点/7段道路及修改、采用、导出、分享数据链通过。用户明确不要Playwright，本轮未运行浏览器。服务已在localhost:3000重启，未部署/更新ZIP。见[完整修复记录](试用问题修复-2026-10-17.md)。不启动后续W队列。

> 同日追加对话修复：真实诊断为模型嵌套动作与执行器格式不一致，非中文没理解。已补重分天数、相关聊天轮次、直接解释回复及失败推荐说明。上海截图同款“同时”实际返回4天7点，原4点保留，新增2景点1商场，另1商场未核对；记录见 `output/w16-dialogue-real-check.json`。仅定向测试/真实HTTP，未浏览器验证。

> 更新：2026-10-16（北京时间）。W00–W14 本地交付已完成，串行队列结束。下方 W13/W12 为历史证据，不再作为待执行任务。

## W14 最终结果

- 项目ID 76dd8317-babb-43f5-bbbc-1e309c51ed73；历史已确认非Git仓库，本轮未重查、未推送/部署。W14结束不再create_thread，不无限继续优化；减少检查、自主推进、功能交互优先的约定继续保留。
- 交付 output/w14-delivery/CitywalkScope-W14.zip（118文件含manifest），同目录SHA256、清单与package-check.json。README/DEPLOY重写，新增功能边界、三亮点演示答辩、W14交付记录；scripts/build-release.cjs可重建包，scripts/accept-release.cjs复现连续链；Windows启动器需自备Node。
- 包按白名单含源码/测试源码/fixtures/vendor许可证/文档/空模板/部署配置，不含真实.env、node_modules、日志、历史output或缓存。配置秘密只内存检查不输出，ZIP解压逐文件字节相同。初次许可证白名单遗漏已修；子进程EPERM经授权后成功。
- 最小验收：Node v24.14.1，从解压候选包无.env/无node_modules启动，43静态资源返回正确，单条连续链一次通过：交通排程→编辑提交→草稿隔离→JSON/HTML/分享同版→库备份/完整未核实恢复→HTTP重核→可信多轮→采用与两次撤销→旧分享不变。output/w14-acceptance.json。临时服务自动停止。
- 最终包仅状态文档与验收候选不同，运行代码/脚本/启动配置哈希一致后沿用验收，不重跑业务/浏览器全套。全部外部服务模拟；未真实DeepSeek/携程/百度/Valhalla、未Node22托管/Docker/真手机导航验证、未发布。目标环境待验收详见DEPLOY.md，不将其伪称已完成。
- 没有业务代码、前端界面、数据契约或离线缓存改动，CACHE仍citywalk-library-shell-v1.2。继续保留EditSession、公开白名单、分享清作者个人记录、本人恢复保留记录但未核实、可信多轮须全点重核等边界。后续视觉见Claude交互契约，未启动任何Claude模型。

---

以下为 W13 交给 W14 时的历史记录（其“下一项W14”等措辞已被上方最终状态取代）。

# Web 大修 · 当前交接

> 更新：2026-10-16（北京时间）。W00–W13已完成，下一项W14：交付包与功能闭环。

## 接手范围

- 项目ID：76dd8317-babb-43f5-bbbc-1e309c51ed73。目录D:\06_Code\codex\携程黑客松比赛Astra大人版本，历史已确认非Git仓库，不重查。W13代码/文档保存后停止修改；11953临时服务和w13浏览器已关闭。
- 只做W14，先读AGENTS.md、执行计划第4节/W14行及本交接；按需读README/DEPLOY/打包脚本和边界，不重新审计全历史。标W14进行中。
- 验收：更新README、部署环境与功能边界、三个亮点演示脚本和答辩材料；交付包排除密钥、真实.env、测试日志/临时缓存及无关历史产物；只针对尚未覆盖的跨模块关键流程做一次最终验收。明确真实外部联调/上线状态，不把本地与模拟通过当上线完成；无Git的实际部署限制如实说明。
- 不需要重做W01–W13或全面美术精修。视觉交接见docs/Claude视觉交接与交互契约.md；未启动任何Claude模型。W14后结束串行队列，不无限创建优化对话，只有实质未完成才创建明确补完项。
- 后续修改离线静态模块务必更新library-sw.js的CACHE版本（当前citywalk-library-shell-v1.2，新增缓存/ui-interactions.mjs）。

## W13代码与验证（已完成，不重跑）

- 新增public/ui-interactions.mjs和docs/Claude视觉交接与交互契约.md；修改app/index/styles、agent-view/editor-view、library-view/library.css/library-sw.js。无依赖/服务端/行程数据契约变更。组件清单、DOM ID、回调/状态与必须保留的交互都已写进视觉文档。
- 快捷导航统一规划/审查/编辑撤销/时间轴/导航附近/依据/交通重试/试走/POI；手机可查询POI。状态汇总只读current、busy、draft、候选区/本机未核实/网络状态，不另存业务数据。已有采用/旧base/草稿/取消保护保持。
- 编辑器重绘按stopId+控件身份恢复焦点，Agent/收藏也接入焦点恢复；快捷锚点展开details并聚焦summary。左右/Home/End只在当前日切换卡片，空白天禁播放；来源链接不吞键盘，试走aria-pressed。取消规划/POI与重试转移焦点，设置重新打开后Key按钮标签归位。
- POI有取消、超时、失败重试、空/演示说明和关闭abort/迟到保护；编辑地点检索补取消。收藏按保存命名、备份、检索、重开重核、历史操作、整条管理分组；原功能及信任提示保留，空预览隐藏，单按钮等待中禁重复点击。移动控件44px、输入16px、focus-visible和弹窗滚动关闭入口。
- 初始app/ui-interactions/library-view/editor-view/agent-view语法通过；后续小改由实际浏览器模块加载/对应交互覆盖。未写镜像单测，未重跑npm test/旧模块全套。
- 一次浏览器会话1280/390：快捷导航与焦点、站点排序焦点跟随/草稿状态/放弃、增空天提交/切日禁播放/键盘首末边界/撤销；POI取消/关闭重开/空/503重试；检索取消；规划取消/失败重试；收藏保存/分组/历史选择/重核取消失败、Escape返回入口；手机无横溢、44px入口；更新后独立库离线刷新可读。Chromium模拟触屏横滑通过（非真手机实机）。
- 首轮脚本预期503透传模拟文案，实际客户端正确返回统一“规划服务暂不可用”，因此等待超时；只修断言，后续流程续跑通过。发现重试入口隐藏会失焦，补焦点交接并只定点复验规划/POI重试和设置标签；所有定点结果ok:true、无pageerror。控制台只有故意503和离线favicon请求失败，未改业务以迎合测试。
- 证据output/w13-browser-check.js、w13-browser-remaining.js、w13-focus-touch-check.js、w13-library-focus-check.js；截图output/playwright/w13-desktop.png、w13-mobile.png、w13-library-desktop.png、w13-library-mobile.png。后半脚本返回coverage是总流程文字，不应误称它单独覆盖全部；以前半已执行断言+后半续跑+定点补验合并记录。
- 所有模型/携程/道路/照片上游使用w11-offline fixture及浏览器路由模拟；底图加载不代表真实联调。未部署、未更新ZIP，未进行全设备/屏幕阅读器认证。无阻断W14的已知新问题。

## W12代码与行为

新增：public/library.mjs、library-view.mjs、library-page.mjs、library.html、library.css、library-sw.js、offline-register.mjs，lib/library-restore.js，test/library.test.cjs。修改app/index、portable-route、roadbook/roadbook-view、itinerary-editor、server及package.json。无新依赖。

- IndexedDB数据库citywalk-library版本1、trips store，每收藏独立ID/name/schemaVersion:1/updatedAt及versions。每次用户主动保存当前已提交版本和可读取照片；不自动保存、不带草稿/候选。每收藏最近20次/24MiB，超限或配额失败旧数据保持。单事务get→change→put保证并发追加不丢失，删除/整库导入同样原子。无账户/云同步/服务端存储。
- 命名/改名、名称城市地点检索、重开、单版本及整个收藏删除、恢复历史为新的最新保存、单版JSON/HTML导出、单收藏历史/全部库备份。备份{format:'citywalk-library',version:1,exportedAt,records}，64MiB/导入1–100收藏/各20版本；所有内容验证通过才一次写入。导入新收藏和保存ID不覆盖已有库，行程ID/个人记录保留；兼容W10公开JSON及旧v1。未知未来版本拒绝，不清库，不声称已有未来迁移器。
- 使用W10白名单不存Key/对话/页面保存偏好/GPS/proof；保存本次同行/住宿/预订/开放规则/已游览。图片只已有canvas可读JPEG，单600000字符/总5MiB。无加密，用户应保管备份；脱敏非任意隐私识别。
- localRoute重新parsePortable去proof并强制restoration:{status:'unverified-local',restoredAt}，该标记加入公开白名单。EditSession.restoreSnapshot保留旧current供20步撤销，恢复本人完整分日、visit/openingRules/booking/progress、道路与原计划，不主动重算；缺schedule才补排程。手动编辑/显式交通重算更新派生安排，但仍未核实。主页面显示未核实来源，UI阻止继续多轮，服务端无proof同样拒绝。用户可新建或在库中重核。
- /api/library/recheck接收copyIntent紧凑名称/城市/地址/日序/方式/条件，补本次context、days.lodging、stops.visit/progress、bookings。客户端坐标/来源URL/营业事实/道路不传不信。复用W11全部唯一匹配、3并发/50查询/120秒/断连取消，失败不mock/部分替换。新建服务身份/source:local-rechecked，保留规范化本人记录；旧自由标题/摘要不签事实，使用固定重核说明。只签新查询地点+固定元数据，再validateCurrent清道路/规范化个人字段。签名12小时/重启失效，不认证实时开放、预订或用户轨迹。
- 重核候选独立预览，不自动改地图；明确接受未知并采用后沿EditSession.restoreSnapshot，可撤销，交通再查；不自动覆盖收藏。草稿/繁忙/旧base保护，取消/关闭/换保存版本使旧请求失效。候选采用清旧对话摘要/重试，保存偏好依W08，不持久化。
- /library.html独立路书和行程库，不启动地图/模型/地点/照片接口。library-sw.js只缓存明确静态模块白名单，不缓存API/密钥/瓦片。首次打开收藏注册需HTTPS或localhost，12秒准备超时提示下载HTML；断网刷新库可读/导出，首页离线导航回落到库。断网不可地图编辑/生成/在线导航；主页面offline提示、外链捕获拦截。路书iframe禁脚本/外部弹窗，下载HTML外链需网。
- 数据只同设备/浏览器/origin（含端口），无痕关闭、清网站数据、回收、换网址设备会丢/不可见。JSON/HTML备份是兜底，不承诺永久。数据库/备份版本1为首版，未知版本拒绝并保留原库。

## W12最小验证（不重跑）

- 3项定向离线测试：完整本人记录/历史/备份/去签名/撤销；重核只信新事实且保留用户条件/预订/progress，失败取消；真实本地HTTP重核→无Key多轮及上游失败。初次URL规范化尾斜杠断言不符，修正预期只重跑对应一项通过，其他两项首次通过。app/library-view语法通过；其他模块已测试或浏览器加载。
- 一次1280/390浏览器会话及定点补验：保存命名改名/检索/历史恢复/重开/单历史及整收藏删除/整库下载导入不覆盖/坏文件；配额异常事务回滚；禁IndexedDB清晰提示；两连接并发3→5保存无丢失。未核实多轮阻止；重核失败、取消、候选隔离/采用/撤销、草稿保护。离线刷新库/主页fallback/返回联网重开，手机无横溢。
- 原图链接停止冒泡导致第一次离线外链仍弹在线标签，改捕获阶段preventDefault+stopPropagation后同一路径复验通过。首次CLI confirm提前返回但脚本继续执行，截图/最终页面确认完成；补验返回ok:true,errors:[]。控制台故意503为预期，曾有favicon.ico 404；未出现脚本异常。
- 截图output/playwright/w12-library-desktop.png、w12-library-mobile.png、w12-offline-mobile.png；脚本output/w12-browser-check.js、w12-boundary-check.js、w12-offline-guard.js，output/w12-backup.json为示例测试备份。上游复用w11-offline fixture，全部模拟；无真实DeepSeek/携程/百度/Valhalla联调、无部署/ZIP更新。

## 保留此前契约

- W10公开packet为citywalk-route/formatVersion1/unsigned-readonly，8MiB，白名单保留ID/revision/context/days/stops/legs/evidence/visit/booking/progress；导入只证明结构，不认证事实。路书原导入依然只读，不自动替换地图。renderRoadbook再次投射转义/CSP，无自动外部资源，动态天气租赁未查询。不得把导出/保存时间当核实时间。
- W11分享/share.html#cw1=SHA256.gzip-base64url完整W10快照，60000字符/512KiB解压限制，0/7/30天仅客户端约定，非认证/访问控制/永久短链。复制接口清原作者同行/住宿/预订/已游览/自填规则，新ID/source:shared-copy，仅签重新查询事实。与W12本人完整恢复不同。
- W08签名只证明服务输出过，12小时/重启失效。validateCurrent仅信签名meta/地点，用户date/visit/booking/progress严格规范化，道路清unknown重算。摘要/偏好仅内存；多轮/Agent候选采用沿编辑事务、未知确认、旧base保护，不把未采用候选当当前事实。
- W06 1–14天/2–50站/N-1段，含跨空天衔接，到达日dayId/fromDayId/kind。预订北京时间source:user/verifiedAt:null，空缓冲null。W09已游览为前缀用户记录/原计划非实际轨迹，protectHistory保护，重核不伪造实际路线。发现GPS只面板内存不导出。WGS84内部、高德GCJ02，保留国内底图/图片代理。

## 每个后续对话必须传递

1. 每完成一项先保存代码/最小验证/AGENTS事实/执行计划/本交接，再list_projects+create_thread在同项目local全新对话继续。用户已授权串行链，无须逐项请示；不fork、不覆盖默认模型、不同时多个主对话改目录。创建后一次有界wait_threads确认启动，最终created-thread卡片结束旧对话，不监督全队列。W13后W14；W14后停止，仅实质未完项才建具体补完，不无限空转。失败记录真实原因与接续信息。
2. 减少检查：复用历史，仅当前必要范围，定向最小验证，通过后停止；不全项目审计/全套/真实服务巡检，纯文档不跑业务测试。
3. 功能交互做全，视觉精修留用户后续Claude；高度自主共同创造，常规可逆直接推进，不等待用户指定已授权队列。
4. 授权全部Web更新，排除对外MCP Server/MCP App/WorkBuddy；保留Web调用携程MCP、/api/ctrip/pois、个人DeepSeek Key、国内底图图片代理和2D/3D。
5. 本地完成不等于上线或全项目完成；未知动态事实持续标未知，模拟测试不冒充真实联调。
