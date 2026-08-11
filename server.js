import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RoomStore } from "./src/room-store.js";

const root = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(root, "public");
const port = Number(process.env.PORT) || 3000;
const store = new RoomStore();
const attempts = new Map();

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
]);

const errorMessages = {
  ROOM_NOT_FOUND: "没有找到这个房间，请检查房间码。",
  ROOM_UNAVAILABLE: "该房间已满或对局已经开始。",
  PLAYER_NOT_FOUND: "玩家身份已失效，请重新进入房间。",
  GAME_NOT_ACTIVE: "当前对局尚未开始或已经结束。",
  NOT_YOUR_TURN: "还没轮到你。",
  CELL_OCCUPIED: "这个格子已经被占用了。",
  INVALID_MOVE: "无效的落子位置。",
  GAME_OVER: "本局已经结束。",
  ROOM_CAPACITY_REACHED: "当前房间过多，请稍后重试。",
};

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("BODY_TOO_LARGE");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function validName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 16) throw new Error("INVALID_NAME");
  return name;
}

function rateLimited(request) {
  const ip = request.headers["x-forwarded-for"]?.split(",")[0].trim()
    ?? request.socket.remoteAddress
    ?? "unknown";
  const now = Date.now();
  const entry = attempts.get(ip) ?? { count: 0, resetAt: now + 60_000 };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + 60_000;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  return entry.count > 90;
}

function apiError(response, error) {
  const clientErrors = new Set([
    "ROOM_NOT_FOUND", "ROOM_UNAVAILABLE", "PLAYER_NOT_FOUND", "GAME_NOT_ACTIVE",
    "NOT_YOUR_TURN", "CELL_OCCUPIED", "INVALID_MOVE", "GAME_OVER",
    "INVALID_NAME", "INVALID_CODE", "INVALID_JSON", "BODY_TOO_LARGE",
  ]);
  const status = error.message === "ROOM_NOT_FOUND" ? 404 : clientErrors.has(error.message) ? 400 : 500;
  const fallback = status === 500 ? "服务器暂时无法处理请求。" : "请求内容不正确。";
  json(response, status, { error: errorMessages[error.message] ?? fallback });
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/healthz") {
    return json(response, 200, { ok: true });
  }

  if (url.pathname.startsWith("/api/") && rateLimited(request)) {
    return json(response, 429, { error: "请求过于频繁，请稍后再试。" });
  }

  try {
    if (request.method === "POST" && url.pathname === "/api/rooms") {
      const body = await readJson(request);
      return json(response, 201, store.createRoom(validName(body.name)));
    }

    if (request.method === "POST" && url.pathname === "/api/rooms/join") {
      const body = await readJson(request);
      const code = String(body.code ?? "");
      if (!/^\d{4}$/.test(code)) throw new Error("INVALID_CODE");
      return json(response, 200, store.joinRoom(code, validName(body.name)));
    }

    const match = url.pathname.match(/^\/api\/rooms\/(\d{4})(?:\/(events|move|leave))?$/);
    if (match) {
      const [, code, action] = match;
      if (request.method === "GET" && action === "events") {
        const playerId = url.searchParams.get("playerId");
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const unsubscribe = store.subscribe(code, playerId, response);
        const heartbeat = setInterval(() => response.write(": ping\n\n"), 20_000);
        heartbeat.unref?.();
        request.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      if (request.method === "GET" && !action) {
        const playerId = url.searchParams.get("playerId");
        return json(response, 200, store.getState(code, playerId));
      }

      if (request.method === "POST" && action === "move") {
        const body = await readJson(request);
        return json(response, 200, store.move(code, body.playerId, body.index));
      }

      if (request.method === "POST" && action === "leave") {
        const body = await readJson(request);
        store.leave(code, body.playerId);
        return json(response, 200, { ok: true });
      }
    }
  } catch (error) {
    return apiError(response, error);
  }

  const staticFile = staticFiles.get(url.pathname);
  if (request.method === "GET" && staticFile) {
    const [filename, contentType] = staticFile;
    response.writeHead(200, { "Content-Type": contentType });
    return createReadStream(join(publicDirectory, filename)).pipe(response);
  }

  json(response, 404, { error: "页面不存在。" });
});

const sweepTimer = setInterval(() => store.sweep(), 60_000);
sweepTimer.unref?.();

server.listen(port, "0.0.0.0", () => {
  console.log(`Duel room game listening on http://0.0.0.0:${port}`);
});
