import test from "node:test";
import assert from "node:assert/strict";
import { createGame, makeMove } from "../src/game.js";
import { RoomStore } from "../src/room-store.js";

test("alternates turns and identifies a winning line", () => {
  const game = createGame();
  makeMove(game, 0, "X");
  makeMove(game, 3, "O");
  makeMove(game, 1, "X");
  makeMove(game, 4, "O");
  const result = makeMove(game, 2, "X");

  assert.deepEqual(result, { finished: true, draw: false });
  assert.equal(game.winnerSymbol, "X");
  assert.deepEqual(game.winningLine, [0, 1, 2]);
});

test("room accepts exactly two players", () => {
  const store = new RoomStore();
  const owner = store.createRoom("甲");
  const guest = store.joinRoom(owner.code, "乙");

  assert.equal(guest.state.status, "playing");
  assert.equal(guest.state.players.length, 2);
  assert.throws(() => store.joinRoom(owner.code, "丙"), /ROOM_UNAVAILABLE/);
});

test("finished room data is removed", async () => {
  const store = new RoomStore({ finishedTtlMs: 15 });
  const x = store.createRoom("甲");
  const o = store.joinRoom(x.code, "乙");
  store.move(x.code, x.playerId, 0);
  store.move(x.code, o.playerId, 3);
  store.move(x.code, x.playerId, 1);
  store.move(x.code, o.playerId, 4);
  const finalState = store.move(x.code, x.playerId, 2);
  assert.equal(finalState.status, "finished");

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.throws(() => store.getState(x.code, x.playerId), /ROOM_NOT_FOUND/);
});
