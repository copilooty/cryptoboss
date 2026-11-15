import { ASSETS, BOARD, MAX_ROUNDS } from "./game-rules.js";

const $ = (selector) => document.querySelector(selector);
const lobby = $("#lobby");
const roomPanel = $("#room-panel");
const gamePanel = $("#game-panel");
const toast = $("#toast");
const playerNameInput = $("#player-name");
const roomCodeInput = $("#room-code");
const connectionLabel = $("#connection-label");
const storedKey = "cryptoboss-room";
const colors = ["#58d6aa", "#ff6573", "#66d8ef", "#f3aa28"];
const borderCells = [
  ...Array.from({ length: 7 }, (_, column) => [1, column + 1]),
  ...Array.from({ length: 6 }, (_, row) => [row + 2, 7]),
  ...Array.from({ length: 6 }, (_, column) => [7, 6 - column]),
  ...Array.from({ length: 5 }, (_, row) => [6 - row, 1])
];

let socket;
let room;
let toastTimer;
let savedSession = null;
try {
  savedSession = JSON.parse(localStorage.getItem(storedKey) || "null");
} catch (error) {
  console.warn("Could not read the saved CryptoBoss session:", error);
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${scheme}//${location.host}/ws`);
  socket.addEventListener("open", () => {
    connectionLabel.textContent = "На связи";
    connectionLabel.parentElement.classList.add("connected");
    if (savedSession?.code && savedSession?.playerId) {
      socket.send(JSON.stringify({
        type: "resume-room", code: savedSession.code, playerId: savedSession.playerId
      }));
    }
  });
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      console.error("Could not parse a server message:", error);
      showToast("Сервер прислал некорректный ответ.", true);
      return;
    }
    if (message.type === "error") showToast(message.message, true);
    if (message.type === "room") {
      room = message.room;
      if (savedSession) {
        savedSession.code = room.code;
        savedSession.playerId = message.playerId;
      }
      localStorage.setItem(storedKey, JSON.stringify(savedSession));
      render();
    }
    if (message.type === "left") {
      room = null;
      savedSession = null;
      localStorage.removeItem(storedKey);
      location.hash = "";
      render();
    }
  });
  socket.addEventListener("close", () => {
    connectionLabel.textContent = "Переподключение...";
    connectionLabel.parentElement.classList.remove("connected");
    setTimeout(connect, 1800);
  });
  socket.addEventListener("error", () => {
    connectionLabel.textContent = "Нет соединения";
    connectionLabel.parentElement.classList.remove("connected");
  });
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast("Нет соединения с сервером. Подключаемся заново.", true);
    return;
  }
  socket.send(JSON.stringify(message));
}

function rememberPlayer(name, code, playerId) {
  savedSession = { name, code, playerId };
  localStorage.setItem(storedKey, JSON.stringify(savedSession));
}

function render() {
  lobby.hidden = Boolean(room);
  roomPanel.hidden = !room || room.status !== "waiting";
  gamePanel.hidden = !room || room.status === "waiting";
  if (!room) return;
  if (room.status === "waiting") renderRoom();
  else renderGame();
}

function renderRoom() {
  const inviteUrl = `${location.origin}${location.pathname}#${room.code}`;
  const players = room.players.map((player, index) => `
    <li class="room-player">
      <span class="player-dot" style="background:${colors[index]}"></span>
      <span>${escapeHtml(player.name)}</span>
      <small>${index === room.owner ? "СОЗДАТЕЛЬ" : "ГОТОВ"}</small>
    </li>
  `).join("");
  roomPanel.innerHTML = `
    <p class="eyebrow">КОМНАТА ОЖИДАНИЯ</p>
    <h1 class="room-title">Зови команду.</h1>
    <p class="room-caption">Поделись кодом с друзьями. Как только соберётесь — начинайте партию.</p>
    <div class="invite-box">
      <span><span class="field-label">КОД КОМНАТЫ</span><span class="invite-code">${room.code}</span></span>
      <button class="button button-secondary" data-action="copy-invite" data-url="${escapeHtml(inviteUrl)}">Копировать ссылку</button>
    </div>
    <ul class="room-players">${players}</ul>
    <div class="room-actions">
      ${room.you === room.owner ? `<button class="button button-primary" data-action="start" ${room.players.length < 2 ? "disabled" : ""}>Начать игру <span aria-hidden="true">→</span></button>` : ""}
      <button class="button button-muted" data-action="leave">Покинуть комнату</button>
    </div>
  `;
}

function tileTokens(position) {
  return room.game.players.map((player, index) => player.position === position && !player.bankrupt
    ? `<i class="token" style="background:${colors[index]}" title="${escapeHtml(player.name)}"></i>`
    : "").join("");
}

function renderBoard(game) {
  const tiles = BOARD.map((tile, index) => {
    const [row, column] = borderCells[index];
    const propertyOwner = game.properties[index];
    const tilePrice = tile.type === "property"
      ? `<span class="tile-price">${tile.price} $${propertyOwner === room.you ? " · ВАШ" : propertyOwner !== undefined ? " · ЗАНЯТ" : ""}</span>`
      : "";
    return `
      <div class="board-tile type-${tile.type} ${game.landed === index ? "is-landed" : ""}"
        style="grid-area:${row} / ${column}" title="${escapeHtml(tile.name)}">
        <i class="tile-color"></i><span class="tile-number">${String(index).padStart(2, "0")}</span>
        <span class="tile-name">${escapeHtml(tile.short)}</span>${tilePrice}
        <span class="tile-tokens">${tileTokens(index)}</span>
      </div>
    `;
  }).join("");
  const active = game.players[game.current];
  return `
    ${tiles}
    <div class="board-center">
      <p class="center-logo">CRYPTO<span>BOSS</span></p>
      <p class="center-sub">ONLINE · ${room.code}</p>
      <div class="turn-display">${game.status === "finished"
        ? `<span class="finish-banner">Партия завершена</span>`
        : `Ход игрока<br><strong>${escapeHtml(active.name)}</strong>`}</div>
      <span class="die">${game.lastRoll || "—"}</span>
      <p class="board-note">${game.lastRoll ? `Бросок: ${game.lastRoll}` : "Вперёд к первому миллиону"}</p>
    </div>
  `;
}

function renderPlayers(game) {
  return game.players.map((player, index) => {
    const worth = player.cash + Object.entries(player.holdings)
      .reduce((sum, [symbol, amount]) => sum + (game.market[symbol] || 0) * amount, 0)
      + Object.entries(game.properties)
        .filter(([, owner]) => owner === index)
        .reduce((sum, [position]) => sum + BOARD[Number(position)].price, 0)
      + player.miners * 60;
    return `
      <div class="game-player ${game.current === index && game.status !== "finished" ? "is-current" : ""} ${player.bankrupt ? "is-bankrupt" : ""}">
        <i class="player-dot" style="background:${colors[index]}"></i>
        <span class="game-player-name">${escapeHtml(player.name)}</span>
        <span class="game-player-worth">${worth.toLocaleString("ru-RU")} $</span>
        <span class="game-player-meta">${player.cash.toLocaleString("ru-RU")} $ · ${player.miners} ферм · ${Object.values(player.holdings).reduce((a, b) => a + b, 0)} монет</span>
      </div>`;
  }).join("");
}

function renderMarket(game, canAct) {
  return `
    <div class="market-list">
      ${ASSETS.map((asset) => `
        <div class="market-row">
          <span class="coin-symbol">${asset.symbol}</span>
          <span class="coin-name">${asset.name}</span>
          <span class="coin-price">${game.market[asset.symbol].toLocaleString("ru-RU")} $</span>
        </div>`).join("")}
    </div>
    ${canAct ? `
      <div class="trade-controls" style="margin-top:12px">
        <select id="trade-asset" class="select-input" aria-label="Криптовалюта">
          ${ASSETS.map((asset) => `<option value="${asset.symbol}">${asset.symbol} · ${asset.name}</option>`).join("")}
        </select>
        <select id="trade-quantity" class="select-input" aria-label="Количество">
          ${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}">${i + 1} шт.</option>`).join("")}
        </select>
      </div>
      <div class="trade-buttons" style="margin-top:7px">
        <button class="button button-secondary" data-action="buy-crypto">Купить</button>
        <button class="button button-secondary" data-action="sell-crypto">Продать</button>
      </div>` : ""}
  `;
}

function actionMessage(game, canAct) {
  if (game.status === "finished") {
    const winner = game.players[game.winner];
    return `<div class="finish-banner">Победитель: ${escapeHtml(winner?.name || "—")}</div>`;
  }
  if (!canAct) return `<p class="action-message">Ожидание хода игрока ${escapeHtml(game.players[game.current].name)}…</p>`;
  if (game.pendingPurchase !== null) {
    const tile = BOARD[game.pendingPurchase];
    return `<p class="action-message">Участок «${escapeHtml(tile.name)}» стоит ${tile.price} USD. Купить?</p>
      <div class="action-controls">
        <button class="button button-primary" data-action="buy-property">Купить</button>
        <button class="button button-muted" data-action="skip-property">Пропустить</button>
      </div>`;
  }
  if (game.phase === "rolling") {
    return `<p class="action-message">Твой ход. Бросай кубик и двигайся по полю.</p>
      <button class="button button-primary" data-action="roll">Бросить кубик <span aria-hidden="true">⚄</span></button>`;
  }
  const tile = BOARD[game.players[game.current].position];
  const miningButton = tile.type === "mining"
    ? `<label class="sr-only" for="miner-quantity">Количество установок</label>
      <select id="miner-quantity" class="select-input">
        ${Array.from({ length: 5 }, (_, i) => `<option value="${i + 1}">${i + 1} установ.</option>`).join("")}
      </select>`
    : "";
  return `<p class="action-message">${tile.type === "mining" ? "Инвестируй в ферму или продолжай ход." : "Можешь совершить сделку на бирже, а затем передать ход."}</p>
    ${tile.type === "mining"
      ? `<div class="mine-controls">${miningButton}<button class="button button-secondary" data-action="buy-miner">Купить ферму</button></div><button class="button button-primary" data-action="end-turn">Завершить ход</button>`
      : `<div class="action-controls"><button class="button button-primary" data-action="end-turn">Завершить ход</button></div>`}`;
}

function renderGame() {
  const game = room.game;
  const canAct = room.you === game.current && game.status === "playing";
  const recentEvents = game.log.slice(0, 12).map((event) => `<li>${escapeHtml(event)}</li>`).join("");
  gamePanel.innerHTML = `
    <div class="game-head">
      <div><p class="eyebrow">ПАРТИЯ · ${room.code}</p><h1 class="game-title">Кто станет боссом?</h1></div>
      <span class="round-badge">РАУНД ${Math.min(game.round, MAX_ROUNDS)} / ${MAX_ROUNDS}</span>
    </div>
    <div class="game-grid">
      <div class="board-shell"><div class="board-grid">${renderBoard(game)}</div></div>
      <div class="side-stack">
        <section class="side-card"><h2 class="side-title">Капитал игроков</h2><div class="player-list">${renderPlayers(game)}</div></section>
        <section class="side-card"><h2 class="side-title">Крипторынок <span>USD</span></h2>${renderMarket(game, canAct)}</section>
        <section class="side-card action-card"><h2 class="side-title">Твой ход</h2>${actionMessage(game, canAct)}</section>
        <section class="side-card"><h2 class="side-title">История партии</h2><ol class="log-list">${recentEvents}</ol></section>
      </div>
    </div>
  `;
}

$("#create-room").addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  if (name.length < 2) return showToast("Введи имя длиной хотя бы 2 символа.", true);
  rememberPlayer(name, "", "");
  send({ type: "create-room", name });
});

$("#join-room").addEventListener("click", () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (name.length < 2) return showToast("Сначала введи своё имя.", true);
  if (!/^[A-Z0-9]{6}$/.test(code)) return showToast("Введи код комнаты из 6 символов.", true);
  rememberPlayer(name, code, "");
  send({ type: "join-room", name, code });
});

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "copy-invite") {
    try {
      await navigator.clipboard.writeText(button.dataset.url);
      showToast("Ссылка-приглашение скопирована.");
    } catch (error) {
      console.error("Could not copy the room invitation:", error);
      showToast("Не удалось скопировать ссылку. Передай друзьям код комнаты.", true);
    }
    return;
  }
  if (action === "start") return send({ type: "start-game" });
  if (action === "leave") {
    return send({ type: "leave-room" });
  }
  if (action === "buy-crypto" || action === "sell-crypto") {
    return send({
      type: "action",
      action: {
        type: action,
        symbol: $("#trade-asset").value,
        quantity: Number($("#trade-quantity").value)
      }
    });
  }
  if (action === "buy-miner") {
    return send({
      type: "action",
      action: { type: "buy-miner", quantity: Number($("#miner-quantity").value) }
    });
  }
  send({ type: "action", action: { type: action } });
});

if (savedSession?.name) playerNameInput.value = savedSession.name;
if (savedSession?.code) roomCodeInput.value = savedSession.code;
if (location.hash.length === 7) roomCodeInput.value = location.hash.slice(1).toUpperCase();
connect();
