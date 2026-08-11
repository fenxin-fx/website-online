import cloudbase from "@cloudbase/js-sdk";
import { cloudbaseConfig } from "./cloudbase-config.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  lobby: $("#lobby"), room: $("#room"), waiting: $("#waiting"), game: $("#game"),
  name: $("#name"), code: $("#code"), create: $("#create"), join: $("#join"),
  leave: $("#leave"), copyCode: $("#copy-code"), lobbyError: $("#lobby-error"),
  gameError: $("#game-error"), status: $("#status"), board: $("#board"),
  playerX: $("#player-x"), playerO: $("#player-o"), cleanup: $("#cleanup"), toast: $("#toast"),
};

let session = null;
let cloudApp = null;
let anonymousLogin = null;
let pollTimer = null;
let cleanupTicker = null;
let syncing = false;

for (let index = 0; index < 9; index += 1) {
  const button = document.createElement("button");
  button.className = "cell";
  button.setAttribute("aria-label", `第 ${index + 1} 格`);
  button.addEventListener("click", () => move(index));
  elements.board.append(button);
}

elements.code.addEventListener("input", () => {
  elements.code.value = elements.code.value.replace(/\D/g, "").slice(0, 4);
});

elements.create.addEventListener("click", () => enter("create", { name: getName() }));
elements.join.addEventListener("click", () => enter("join", { name: getName(), code: elements.code.value }));
elements.code.addEventListener("keydown", (event) => { if (event.key === "Enter") elements.join.click(); });
elements.copyCode.addEventListener("click", async () => {
  await navigator.clipboard.writeText(session.code);
  showToast("房间码已复制");
});
elements.leave.addEventListener("click", leaveRoom);

function getName() {
  return elements.name.value.trim();
}

function getCloudApp() {
  const config = cloudbaseConfig;
  if (!config?.envId || config.envId === "YOUR_ENV_ID") {
    throw new Error("网站正在配置 CloudBase 环境，请稍后再试。");
  }
  if (!cloudApp) {
    cloudApp = cloudbase.init({ env: config.envId, region: config.region ?? "ap-shanghai" });
  }
  return cloudApp;
}

async function ensureAnonymousLogin() {
  if (!anonymousLogin) {
    anonymousLogin = (async () => {
      const auth = getCloudApp().auth();
      const state = await auth.getLoginState();
      if (!state?.isAnonymousAuth) await auth.signInAnonymously();
    })().catch((error) => {
      anonymousLogin = null;
      throw error;
    });
  }
  await anonymousLogin;
}

async function request(action, payload = {}) {
  const config = cloudbaseConfig;
  await ensureAnonymousLogin();
  const response = await getCloudApp().callFunction({
    name: config.functionName ?? "room-api",
    data: { action, ...payload },
  });
  const result = response.result;
  if (!result?.ok) throw new Error(result?.error ?? "请求失败，请稍后重试。");
  return result.value;
}

async function enter(action, body) {
  elements.lobbyError.textContent = "";
  if (!body.name) {
    elements.lobbyError.textContent = "请先输入昵称。";
    elements.name.focus();
    return;
  }
  if (action === "join" && !/^\d{4}$/.test(body.code)) {
    elements.lobbyError.textContent = "请输入四位数字房间码。";
    elements.code.focus();
    return;
  }

  setBusy(true);
  try {
    const result = await request(action, body);
    session = { code: result.code, playerId: result.playerId };
    elements.lobby.classList.add("hidden");
    elements.room.classList.remove("hidden");
    render(result.state);
    startPolling();
  } catch (error) {
    elements.lobbyError.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshState, 1500);
}

async function refreshState() {
  if (!session || syncing) return;
  syncing = true;
  try {
    render(await request("state", session));
  } catch (error) {
    if (/没有找到这个房间|身份已失效/.test(error.message)) {
      showToast("对局数据已清理");
      resetToLobby();
    }
  } finally {
    syncing = false;
  }
}

function render(state) {
  elements.copyCode.textContent = state.code;
  elements.waiting.classList.toggle("hidden", state.status !== "waiting");
  elements.game.classList.toggle("hidden", state.status === "waiting");
  if (state.status === "waiting") return;

  const x = state.players.find((player) => player.symbol === "X");
  const o = state.players.find((player) => player.symbol === "O");
  elements.playerX.querySelector("span").textContent = labelPlayer(x, state);
  elements.playerO.querySelector("span").textContent = labelPlayer(o, state);
  elements.playerX.classList.toggle("active", state.status === "playing" && state.game.turnSymbol === "X");
  elements.playerO.classList.toggle("active", state.status === "playing" && state.game.turnSymbol === "O");

  const myTurn = state.status === "playing" && state.game.turnSymbol === state.me.symbol;
  [...elements.board.children].forEach((cell, index) => {
    const symbol = state.game.board[index];
    cell.textContent = symbol ?? "";
    cell.className = `cell ${symbol?.toLowerCase() ?? ""}`;
    if (state.game.winningLine.includes(index)) cell.classList.add("win");
    cell.disabled = !myTurn || Boolean(symbol);
  });

  elements.status.textContent = statusText(state, myTurn);
  updateCleanup(state.cleanupAt);
}

function labelPlayer(player, state) {
  if (!player) return "等待加入";
  return `${player.name}${player.symbol === state.me.symbol ? "（你）" : ""}`;
}

function statusText(state, myTurn) {
  if (state.status === "playing") return myTurn ? "轮到你落子" : "等待对方落子";
  if (state.game.abandonedBy) return state.game.winnerSymbol === state.me.symbol ? "对方已离开，你获胜" : "你已离开本局";
  if (state.game.draw) return "平局，好棋！";
  return state.game.winnerSymbol === state.me.symbol ? "你赢了！" : "对方获胜";
}

async function move(index) {
  elements.gameError.textContent = "";
  try {
    render(await request("move", { ...session, index }));
  } catch (error) {
    elements.gameError.textContent = error.message;
  }
}

async function leaveRoom() {
  if (session) {
    try {
      await request("leave", session);
    } catch { /* The room may already have been cleaned. */ }
  }
  resetToLobby();
}

function resetToLobby() {
  clearInterval(pollTimer);
  pollTimer = null;
  session = null;
  clearInterval(cleanupTicker);
  elements.room.classList.add("hidden");
  elements.lobby.classList.remove("hidden");
  elements.waiting.classList.add("hidden");
  elements.game.classList.add("hidden");
  elements.cleanup.textContent = "";
  elements.gameError.textContent = "";
}

function updateCleanup(cleanupAt) {
  clearInterval(cleanupTicker);
  if (!cleanupAt) {
    elements.cleanup.textContent = "";
    return;
  }
  const tick = () => {
    const seconds = Math.max(0, Math.ceil((cleanupAt - Date.now()) / 1000));
    elements.cleanup.textContent = `本局数据将在 ${seconds} 秒后自动清理`;
  };
  tick();
  cleanupTicker = setInterval(tick, 1000);
}

function setBusy(value) {
  elements.create.disabled = value;
  elements.join.disabled = value;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  setTimeout(() => elements.toast.classList.remove("show"), 1800);
}
