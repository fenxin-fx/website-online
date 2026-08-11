import { randomInt, randomUUID } from "node:crypto";
import { createGame, makeMove } from "./game.js";

const ROOM_CODE_MIN = 1000;
const ROOM_CODE_MAX_EXCLUSIVE = 10000;

export class RoomStore {
  constructor({ finishedTtlMs = 10_000, idleTtlMs = 30 * 60_000 } = {}) {
    this.rooms = new Map();
    this.finishedTtlMs = finishedTtlMs;
    this.idleTtlMs = idleTtlMs;
  }

  createRoom(name) {
    const code = this.#newCode();
    const player = this.#newPlayer(name, "X");
    const room = {
      code,
      status: "waiting",
      players: [player],
      game: createGame(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      cleanupAt: null,
      cleanupTimer: null,
      subscribers: new Map(),
    };
    this.rooms.set(code, room);
    return { code, playerId: player.id, state: this.publicState(room, player.id) };
  }

  joinRoom(code, name) {
    const room = this.#requiredRoom(code);
    if (room.status !== "waiting" || room.players.length !== 1) {
      throw new Error("ROOM_UNAVAILABLE");
    }
    const player = this.#newPlayer(name, "O");
    room.players.push(player);
    room.status = "playing";
    room.updatedAt = Date.now();
    this.broadcast(room);
    return { code: room.code, playerId: player.id, state: this.publicState(room, player.id) };
  }

  getState(code, playerId) {
    const room = this.#requiredRoom(code);
    this.#requiredPlayer(room, playerId);
    return this.publicState(room, playerId);
  }

  move(code, playerId, index) {
    const room = this.#requiredRoom(code);
    const player = this.#requiredPlayer(room, playerId);
    if (room.status !== "playing") throw new Error("GAME_NOT_ACTIVE");

    const result = makeMove(room.game, index, player.symbol);
    room.updatedAt = Date.now();
    if (result.finished) {
      room.status = "finished";
      this.#scheduleCleanup(room);
    }
    this.broadcast(room);
    return this.publicState(room, playerId);
  }

  leave(code, playerId) {
    const room = this.rooms.get(String(code));
    if (!room) return;
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) return;

    if (room.status === "waiting") {
      this.deleteRoom(room.code, "房间已关闭");
      return;
    }

    if (room.status === "playing") {
      const opponent = room.players.find((candidate) => candidate.id !== playerId);
      room.status = "finished";
      room.game.winnerSymbol = opponent?.symbol ?? null;
      room.game.abandonedBy = player.symbol;
      room.updatedAt = Date.now();
      this.#scheduleCleanup(room);
      this.broadcast(room);
    }
  }

  subscribe(code, playerId, response) {
    const room = this.#requiredRoom(code);
    this.#requiredPlayer(room, playerId);
    const responses = room.subscribers.get(playerId) ?? new Set();
    responses.add(response);
    room.subscribers.set(playerId, responses);
    this.#send(response, "state", this.publicState(room, playerId));

    return () => {
      responses.delete(response);
      if (responses.size === 0) room.subscribers.delete(playerId);
    };
  }

  broadcast(room) {
    for (const [playerId, responses] of room.subscribers) {
      const state = this.publicState(room, playerId);
      for (const response of responses) this.#send(response, "state", state);
    }
  }

  publicState(room, playerId) {
    const me = this.#requiredPlayer(room, playerId);
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

  sweep(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (now - room.updatedAt > this.idleTtlMs) {
        this.deleteRoom(room.code, "房间因长时间无操作已清理");
      }
    }
  }

  deleteRoom(code, message = "对局数据已清理") {
    const room = this.rooms.get(String(code));
    if (!room) return;
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    for (const responses of room.subscribers.values()) {
      for (const response of responses) {
        this.#send(response, "deleted", { message });
        response.end();
      }
    }
    room.players.length = 0;
    room.game.board.fill(null);
    room.subscribers.clear();
    this.rooms.delete(room.code);
  }

  #scheduleCleanup(room) {
    if (room.cleanupTimer) return;
    room.cleanupAt = Date.now() + this.finishedTtlMs;
    room.cleanupTimer = setTimeout(
      () => this.deleteRoom(room.code),
      this.finishedTtlMs,
    );
    room.cleanupTimer.unref?.();
  }

  #requiredRoom(code) {
    const room = this.rooms.get(String(code));
    if (!room) throw new Error("ROOM_NOT_FOUND");
    return room;
  }

  #requiredPlayer(room, playerId) {
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    return player;
  }

  #newPlayer(name, symbol) {
    return { id: randomUUID(), name, symbol };
  }

  #newCode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = String(randomInt(ROOM_CODE_MIN, ROOM_CODE_MAX_EXCLUSIVE));
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("ROOM_CAPACITY_REACHED");
  }

  #send(response, event, value) {
    if (!response.destroyed) {
      response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
    }
  }
}
