# 方格对决：双人联机房间示例

这是一个可直接部署的双人网页游戏。它提供四位数房间码、状态同步、严格两人上限，以及对局结束后的服务端数据清理。

## 本地运行

需要 Node.js 20 或更高版本，不需要安装第三方依赖。

```powershell
npm start
```

然后访问 `http://localhost:3000`。用两个浏览器窗口分别创建和加入同一个房间即可测试。

运行测试：

```powershell
npm test
```

## CloudBase 免费部署（推荐）

此项目现在可部署到腾讯云 CloudBase 免费环境：网页是静态托管，房间数据由云函数和文档型数据库处理，因此不需要购买或常驻服务器。

1. 在 [CloudBase 控制台](https://tcb.cloud.tencent.com/) 创建免费环境，区域选上海，并记下环境 ID。
2. 在「文档型数据库」创建集合 `duel_rooms`，权限设为“仅管理端可读写”。浏览器不会直接访问数据库。
3. 在「云函数 → 权限控制」配置以下规则，让游戏网页能调用 `room-api`，但不暴露定时清理函数：

```json
{
  "*": { "invoke": false },
  "room-api": { "invoke": true }
}
```

4. 将 `public/cloudbase-config.js` 和 `cloudbaserc.json` 内的 `YOUR_ENV_ID` 替换成真实环境 ID。
5. 安装 CloudBase CLI 后，在项目根目录部署两个函数并同步定时触发器：

```powershell
npm install --global @cloudbase/cli
tcb login
tcb fn deploy --all
tcb fn trigger create
```

6. 构建并把 `dist` 目录上传到「静态网站托管」：

```powershell
npm install
npm run build
```

上传后使用 CloudBase 分配的 `*.tcloudbaseapp.com` 默认网址即可邀请熟人测试。默认网址带有访问频率限制；面向更多用户时再绑定已备案的自定义域名。

### CloudBase 数据生命周期

- 每次页面同步都只调用云函数，不让客户端直接读取或修改房间数据。
- 云函数用数据库事务加入房间，确保同一房间最多只有两名玩家。
- 对局结束或有玩家离开后，最终状态显示 10 秒；随后数据会被访问请求立即删除，云端定时函数每分钟额外清理遗漏的过期房间。
- 30 分钟没有任何操作的房间也会自动清理。

## 本地 Node 版本的数据生命周期

- 房间和棋局只保存在当前 Node.js 进程内，不写数据库或磁盘。
- 正常结束或玩家主动离开后，最终状态保留 10 秒供双方展示，随后清空玩家、棋盘、连接并删除房间。
- 30 分钟无操作的房间也会自动清理。
- 服务重启会清空所有未完成房间。这适合轻量游戏；若要跨实例或断电恢复，可将 `RoomStore` 替换为 Redis。

## 替换成你的游戏

井字棋规则集中在 `src/game.js`。保留房间 API 和 `RoomStore`，把 `createGame`、`makeMove` 及前端棋盘渲染替换为你的游戏状态和操作即可。

## 部署到 Zeabur（可选）

项目已包含 `zbpack.json`，Zeabur 会使用 npm 构建并通过 `npm start` 启动服务。将仓库导入 Zeabur 后，在服务的 Networking 页面生成免费的 `.zeabur.app` 域名即可访问。服务使用平台提供的 `PORT`，不需要数据库或密钥。

仓库同时保留了 `render.yaml`，需要时仍可部署到 Render。
