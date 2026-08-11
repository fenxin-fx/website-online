# 方格对决：双人联机房间底座

这是一个部署在腾讯云 CloudBase 的静态网页小游戏示例。它的联机层已经具备：四位数字房间码、最多两人、服务端校验轮次与落子、匿名访问、状态轮询，以及结束后自动清理对局数据。

当前线上地址：<https://duel-room-game-d0g9srjm98caba38f-1466556965.tcloudbaseapp.com>

## 项目结构

- `public/`：Vite 前端和当前井字棋页面。
- `cloudfunctions/room-api/`：唯一对浏览器开放的房间 API；包含两人上限、事务和游戏状态校验。
- `cloudfunctions/room-cleanup/`：每分钟清理过期房间，浏览器不可调用。
- `cloudbaserc.json`：CloudBase 环境、函数规格、函数权限和定时触发器。
- `INTEGRATION.md`：交给另一位 Codex 接入新游戏时应遵守的接口和步骤。

浏览器不会直接读写 `duel_rooms` 数据库集合，集合应保持“仅管理端可读写”。

## 本地检查

要求 Node.js 20 或更高版本。

```powershell
npm install
npm test
npm run build
```

`npm start` 可预览当前网页，但本地预览没有 CloudBase 房间后端；完整联机测试请使用已部署的 CloudBase 环境。

## 重新部署到当前 CloudBase 环境

已安装项目依赖后，在项目根目录运行：

```powershell
npx tcb login
npx tcb fn deploy --all --force --install-dependency true -e duel-room-game-d0g9srjm98caba38f -r ap-shanghai
npm run build
npx tcb hosting deploy .\dist -e duel-room-game-d0g9srjm98caba38f -r ap-shanghai
```

如需迁移到新环境：创建文档型数据库集合 `duel_rooms`（权限为“仅管理端可读写”），替换 `public/cloudbase-config.js` 和 `cloudbaserc.json` 中的 `envId`，再部署函数和静态网站。请同时在 CloudBase 控制台开启匿名登录，并把静态网站域名添加到安全域名列表。

函数权限应保持如下最小范围：

```json
{
  "*": { "invoke": false },
  "room-api": { "invoke": true }
}
```

## 房间数据生命周期

- 空闲房间：30 分钟后过期。
- 正常结束或有人离开：显示最终状态 10 秒后过期。
- 页面再次请求状态时会立即移除过期房间；`room-cleanup` 每分钟补偿清理一次。

旧的 `server.js`、`render.yaml` 和 `zbpack.json` 是之前单机/其他平台的历史备选文件；当前正式部署路径是 CloudBase。
