# 将你的小游戏接入双人联机底座

目标是用你的游戏内容替换当前井字棋 UI，同时保留已有的 CloudBase 房间、双人限制和自动清理能力。

## 必须保留的边界

1. 浏览器只能调用 `room-api` 云函数，不能直接访问 `duel_rooms`。
2. `room-api` 必须继续是唯一公开函数；`room-cleanup` 必须保持不可公开。
3. 房间码必须为四位数字，且只有服务端生成。
4. 所有会影响胜负、回合、资源或棋盘的操作，都必须由云函数验证并写入数据库事务；不能相信浏览器传来的结果。

## 前端调用约定

前端使用 `getCloudApp().callFunction({ name: "room-api", data })`。`public/app.js` 中的 `request(action, payload)` 已处理匿名登录和错误返回，可直接复用。

| action | 请求字段 | 成功结果 |
| --- | --- | --- |
| `create` | `name` | `{ code, playerId, state }` |
| `join` | `name`, `code` | `{ code, playerId, state }` |
| `state` | `code`, `playerId` | `state` |
| `move` | `code`, `playerId`, `index` | `state` |
| `leave` | `code`, `playerId` | `{ ok: true }` |

`state` 的公共字段为 `code`、`status`（`waiting` / `playing` / `finished`）、`me`、`players`、`game` 和 `cleanupAt`。不要把其他玩家的 `playerId` 返回给浏览器。

## 替换游戏规则

当前示例把井字棋规则放在 `cloudfunctions/room-api/index.js` 的以下函数中：

- `createGame()`：新局初始状态。
- `makeMove(game, index, symbol)`：服务端验证操作并更新状态。
- `gameFinished(game)`：判定结局。
- `publicState(room, playerId)`：筛选可下发给玩家的公共状态。

将 `move` 的 `index` 换成你的操作参数，例如 `{ type: "playCard", cardId }`。同步更新前端按钮/渲染逻辑和 `move()` 请求体。结局产生时仍需把 `room.status` 设为 `finished`，并设置：

```js
room.cleanupAt = Date.now() + 10_000;
room.expiresAt = room.cleanupAt;
```

对每次写回房间，调用既有的 `saveRoom(transaction, code, room)`；它会排除不可修改的 `_id`，避免事务写入错误。

## 部署步骤

```powershell
npm install
npm test
npm run build
npx tcb login
npx tcb fn deploy --all --force --install-dependency true -e <你的环境ID> -r ap-shanghai
npx tcb hosting deploy .\dist -e <你的环境ID> -r ap-shanghai
```

首次迁移时，在 CloudBase 建立 `duel_rooms` 文档集合并设为“仅管理端可读写”；开启匿名登录；将静态托管域名加入安全域名。函数权限配置参见 `README.md`。
