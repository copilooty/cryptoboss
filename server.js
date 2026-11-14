import { createServer } from "node:http";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { applyAction, createGameState, MAX_PLAYERS } from "./game-rules.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDirectory = join(root, "data");
const roomsFile = join(dataDirectory, "rooms.json");
const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};
let saveQueue = Promise.resolve();

async function saveRooms() {
  const contents = JSON.stringify([...rooms.values()]);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    const temporaryFile = `${roomsFile}.tmp`;
    await writeFile(temporaryFile, contents, "utf8");
    await rename(temporaryFile, roomsFile);
  });
  return saveQueue;
}

async function loadRooms() {
  try {
    const savedRooms = JSON.parse(await readFile(roomsFile, "utf8"));
    if (!Array.isArray(savedRooms)) throw new Error("Saved room data must be an array.");
    for (const room of savedRooms) {
      if (typeof room.code === "string" && Array.isArray(room.players)) rooms.set(room.code, room);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function safeSend(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function publicRoom(room, playerId) {
  const playerIndex = room.players.findIndex((player) => player.id === playerId);
  const game = room.game && structuredClone(room.game);
  if (game) {
    game.winner = game.players.findIndex((player) => player.id === game.winner);
    game.properties = Object.fromEntries(Object.entries(game.properties)
      .map(([position, ownerId]) => [position, game.players.findIndex((player) => player.id === ownerId)]));
    game.players = game.players.map(({ name, cash, position, holdings, miners, bankrupt }) =>
      ({ name, cash, position, holdings, miners, bankrupt }));
  }
  return {
    code: room.code,
    status: room.status,
    players: room.players.map(({ name, ready }) => ({ name, ready })),
    owner: room.players.findIndex((player) => player.id === room.ownerId),
    you: playerIndex,
    game
  };
}

function sendRoom(room, playerId, socket) {
  safeSend(socket, { type: "room", playerId, room: publicRoom(room, playerId) });
}

function broadcastRoom(room) {
  for (const socket of wss.clients) {
    if (socket.roomCode === room.code && socket.playerId) sendRoom(room, socket.playerId, socket);
  }
}

function cleanName(value) {
  if (typeof value !== "string") throw new Error("Введите имя игрока.");
  const name = value.trim().replace(/\s+/g, " ").slice(0, 20);
  if (name.length < 2) throw new Error("Имя должно содержать хотя бы 2 символа.");
  return name;
}

function cleanCode(value) {
  if (typeof value !== "string" || !/^[A-Z0-9]{6}$/.test(value.toUpperCase())) {
    throw new Error("Код комнаты должен состоять из 6 букв или цифр.");
  }
  return value.toUpperCase();
}

function bindPlayer(socket, room, player) {
  socket.roomCode = room.code;
  socket.playerId = player.id;
  sendRoom(room, player.id, socket);
}

async function processMessage(socket, message) {
  if (!message || typeof message.type !== "string") throw new Error("Неизвестный запрос.");

  if (message.type === "create-room") {
    const name = cleanName(message.name);
    let code;
    do {
      code = randomBytes(3).toString("hex").toUpperCase();
    } while (rooms.has(code));
    const player = { id: randomUUID(), name, ready: true };
    const room = { code, status: "waiting", ownerId: player.id, players: [player], game: null };
    rooms.set(code, room);
    try {
      await saveRooms();
    } catch (error) {
      rooms.delete(code);
      throw error;
    }
    bindPlayer(socket, room, player);
    return;
  }

  if (message.type === "join-room") {
    const code = cleanCode(message.code);
    const name = cleanName(message.name);
    const room = rooms.get(code);
    if (!room) throw new Error("Комната не найдена. Проверьте код приглашения.");
    if (room.status !== "waiting") throw new Error("Партия уже началась — присоединиться нельзя.");
    if (room.players.length >= MAX_PLAYERS) throw new Error("В комнате уже 4 игрока.");
    const player = { id: randomUUID(), name, ready: true };
    room.players.push(player);
    try {
      await saveRooms();
    } catch (error) {
      room.players.pop();
      throw error;
    }
    bindPlayer(socket, room, player);
    broadcastRoom(room);
    return;
  }

  if (message.type === "resume-room") {
    const code = cleanCode(message.code);
    const room = rooms.get(code);
    const player = room?.players.find((item) => item.id === message.playerId);
    if (!player) throw new Error("Не удалось восстановить комнату. Создайте или откройте её заново.");
    bindPlayer(socket, room, player);
    return;
  }

  const room = rooms.get(socket.roomCode);
  const player = room?.players.find((item) => item.id === socket.playerId);
  if (!room || !player) throw new Error("Сначала создайте комнату или войдите по коду.");

  if (message.type === "leave-room") {
    if (room.status !== "waiting") throw new Error("Нельзя покинуть комнату после начала партии.");
    const previousOwner = room.ownerId;
    const previousPlayers = room.players;
    room.players = room.players.filter((item) => item.id !== player.id);
    if (!room.players.length) {
      rooms.delete(room.code);
    } else {
      if (room.ownerId === player.id) room.ownerId = room.players[0].id;
    }
    try {
      await saveRooms();
    } catch (error) {
      rooms.set(room.code, room);
      room.players = previousPlayers;
      room.ownerId = previousOwner;
      throw error;
    }
    socket.roomCode = null;
    socket.playerId = null;
    safeSend(socket, { type: "left" });
    if (room.players.length) broadcastRoom(room);
    return;
  } else if (message.type === "start-game") {
    if (player.id !== room.ownerId) throw new Error("Начать партию может только создатель комнаты.");
    if (room.status !== "waiting") throw new Error("Партия уже началась.");
    if (room.players.length < 2) throw new Error("Пригласите хотя бы одного друга, чтобы начать.");
    room.game = createGameState(room.players.map(({ id, name }) => ({ id, name })));
    room.status = "playing";
    try {
      await saveRooms();
    } catch (error) {
      room.game = null;
      room.status = "waiting";
      throw error;
    }
  } else if (message.type === "action") {
    if (room.status !== "playing") throw new Error("Партия ещё не началась.");
    const previousGame = room.game;
    room.game = applyAction(previousGame, player.id, message.action, () => randomInt(0, 1_000_000) / 1_000_000);
    if (room.game.status === "finished") room.status = "finished";
    try {
      await saveRooms();
    } catch (error) {
      room.game = previousGame;
      room.status = "playing";
      throw error;
    }
  } else {
    throw new Error("Неизвестный запрос.");
  }

  broadcastRoom(room);
}

const server = createServer(async (request, response) => {
  let relativePath;
  try {
    const pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
    relativePath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).slice(1);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  const file = resolve(root, relativePath);
  const pathFromRoot = relative(root, file);
  if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith("..") || pathFromRoot.split(/[\\/]/).includes("data")) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    response.end(body);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") {
      response.writeHead(404).end("Not found");
      return;
    }
    console.error("Could not serve project file:", error);
    response.writeHead(500).end("Server error");
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url, "http://localhost").pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
});

wss.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      safeSend(socket, { type: "error", message: "Некорректный формат запроса." });
      return;
    }
    void processMessage(socket, message)
      .catch((error) => {
        safeSend(socket, { type: "error", message: error.message || "Не удалось выполнить запрос." });
      });
  });
  socket.on("error", (error) => console.error("WebSocket error:", error.message));
});

await loadRooms();
server.listen(port, "0.0.0.0", () => console.log(`CryptoBoss is listening on port ${port}`));
