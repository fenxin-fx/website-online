const { randomInt, randomUUID } = require("node:crypto");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const rooms = db.collection("duel_rooms");
const ROOM_CODE_MIN = 1000;
const ROOM_CODE_MAX_EXCLUSIVE = 10000;
const FINISHED_TTL_MS = 10_000;
const IDLE_TTL_MS = 30 * 60_000;

const errorMessages = {
  ROOM_NOT_FOUND: "没有找到这个房间，请检查房间码。",
  ROOM_UNAVAILABLE: "该房间已满或对局已经开始。",
  PLAYER_NOT_FOUND: "玩家身份已失效，请重新进入房间。",
  GAME_NOT_ACTIVE: "当前对局尚未开始或已经结束。",
  NOT_YOUR_TURN: "还没轮到你。",
  CELL_OCCUPIED: "这个格子已经被占用了。",
  INVALID_MOVE: "无效的落子位置。",
  GAME_OVER: "本局已经结束。",
  INVALID_NAME: "昵称需要是 1 到 16 个字符。",
  INVALID_CODE: "请输入四位数字房间码。",
  ROOM_CAPACITY_REACHED: "当前房间过多，请稍后重试。",
};

const winningLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6],
  [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6],
];

exports.main = async (event = {}) => {
  try {
    let value;
    switch (event.action) {
      case "create": value = await createRoom(validName(event.name)); break;
      case "join": value = await joinRoom(validCode(event.code), validName(event.name)); break;
      case "state": value = await getState(validCode(event.code), event.playerId); break;
      case "move": value = await move(validCode(event.code), event.playerId, event.index); break;
      case "leave": value = await leave(validCode(event.code), event.playerId); break;
      default: throw new Error("INVALID_ACTION");
    }
    return { ok: true, value };
  } catch (error) {
    console.error("room-api failed", { action: event.action, message: error.message });
    return { ok: false, error: errorMessages[error.message] ?? "服务器暂时无法处理请求。" };
  }
};

async function createRoom(name) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = String(randomInt(ROOM_CODE_MIN, ROOM_CODE_MAX_EXCLUSIVE));
    const now = Date.now();
    const player = { id: randomUUID(), name, symbol: "X" };
    const room = {
      _id: code,
      code,
      status: "waiting",
      players: [player],
      game: createGame(),
      createdAt: now,
      updatedAt: now,
      cleanupAt: null,
      expiresAt: now + IDLE_TTL_MS,
    };
    try {
      await rooms.add(room);
      return { code, playerId: player.id, state: publicState(room, player.id) };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }
  throw new Error("ROOM_CAPACITY_REACHED");
}

async function joinRoom(code, name) {
  return inRoomTransaction(code, null, async (transaction, room) => {
    if (room.status !== "waiting" || room.players.length !== 1) throw new Error("ROOM_UNAVAILABLE");
    const player = { id: randomUUID(), name, symbol: "O" };
    room.players.push(player);
    touch(room);
    room.status = "playing";
    await transaction.collection("duel_rooms").doc(code).update({ data: room });
    return { code, playerId: player.id, state: publicState(room, player.id) };
  });
}

async function getState(code, playerId) {
  const room = await requiredRoom(code);
  removeIfExpired(room);
  return publicState(room, playerId);
}

async function move(code, playerId, index) {
  return inRoomTransaction(code, playerId, async (transaction, room, player) => {
    if (room.status !== "playing") throw new Error("GAME_NOT_ACTIVE");
    makeMove(room.game, index, player.symbol);
    touch(room);
    if (gameFinished(room.game)) {
      room.status = "finished";
      room.cleanupAt = Date.now() + FINISHED_TTL_MS;
      room.expiresAt = room.cleanupAt;
    }
    await transaction.collection("duel_rooms").doc(code).update({ data: room });
    return publicState(room, playerId);
  });
}

async function leave(code, playerId) {
  return inRoomTransaction(code, playerId, async (transaction, room, player) => {
    if (room.status === "waiting") {
      await transaction.collection("duel_rooms").doc(code).remove();
      return { ok: true };
    }
    if (room.status === "playing") {
      const opponent = room.players.find((candidate) => candidate.id !== player.id);
      room.status = "finished";
      room.game.winnerSymbol = opponent?.symbol ?? null;
      room.game.abandonedBy = player.symbol;
      room.cleanupAt = Date.now() + FINISHED_TTL_MS;
      room.expiresAt = room.cleanupAt;
      room.updatedAt = Date.now();
      await transaction.collection("duel_rooms").doc(code).update({ data: room });
    }
    return { ok: true };
  });
}

async function inRoomTransaction(code, playerId, update) {
  const outcome = await db.runTransaction(async (transaction) => {
    const result = await transaction.collection("duel_rooms").doc(code).get();
    const room = result.data;
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (room.expiresAt <= Date.now()) {
      await transaction.collection("duel_rooms").doc(code).remove();
      throw new Error("ROOM_NOT_FOUND");
    }
    const player = playerId ? requiredPlayer(room, playerId) : null;
    return update(transaction, room, player);
  }, 5);
  return outcome?.result ?? outcome;
}

async function requiredRoom(code) {
  const result = await rooms.doc(code).get();
  if (!result.data) throw new Error("ROOM_NOT_FOUND");
  return result.data;
}

function removeIfExpired(room) {
  if (room.expiresAt > Date.now()) return;
  rooms.doc(room.code).remove().catch((error) => console.error("expired room removal failed", error));
  throw new Error("ROOM_NOT_FOUND");
}

function requiredPlayer(room, playerId) {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("PLAYER_NOT_FOUND");
  return player;
}

function publicState(room, playerId) {
  const me = requiredPlayer(room, playerId);
  return {
    code: room.code,
    status: room.status,
    me: { name: me.name, symbol: me.symbol },
    players: room.players.map(({ name, symbol }) => ({ name, symbol })),
    game: {
      board: room.game.board,
      turnSymbol: room.game.turnSymbol,
      winnerSymbol: room.game.winnerSymbol,
      winningLine: room.game.winningLine,
      abandonedBy: room.game.abandonedBy ?? null,
      draw: room.game.moveCount === 9 && !room.game.winnerSymbol,
    },
    cleanupAt: room.cleanupAt,
  };
}

function touch(room) {
  const now = Date.now();
  room.updatedAt = now;
  room.expiresAt = now + IDLE_TTL_MS;
}

function validName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 16) throw new Error("INVALID_NAME");
  return name;
}

function validCode(value) {
  const code = String(value ?? "");
  if (!/^\d{4}$/.test(code)) throw new Error("INVALID_CODE");
  return code;
}

function createGame() {
  return { board: Array(9).fill(null), turnSymbol: "X", winnerSymbol: null, winningLine: [], moveCount: 0 };
}

function makeMove(game, index, symbol) {
  if (!Number.isInteger(index) || index < 0 || index > 8) throw new Error("INVALID_MOVE");
  if (gameFinished(game)) throw new Error("GAME_OVER");
  if (symbol !== game.turnSymbol) throw new Error("NOT_YOUR_TURN");
  if (game.board[index]) throw new Error("CELL_OCCUPIED");
  game.board[index] = symbol;
  game.moveCount += 1;
  const line = winningLines.find((cells) => cells.every((cell) => game.board[cell] === symbol));
  if (line) {
    game.winnerSymbol = symbol;
    game.winningLine = line;
  } else if (game.moveCount < 9) {
    game.turnSymbol = symbol === "X" ? "O" : "X";
  }
}

function gameFinished(game) {
  return Boolean(game.winnerSymbol) || game.moveCount === 9;
}

function isDuplicateKey(error) {
  return /duplicate|E11000|already exists/i.test(String(error?.message ?? error));
}
