export const MAX_PLAYERS = 4;
export const MAX_ROUNDS = 16;

export const ASSETS = [
  { symbol: "BTC", name: "Bitcoin", price: 180 },
  { symbol: "ETH", name: "Ethereum", price: 120 },
  { symbol: "SOL", name: "Solana", price: 90 },
  { symbol: "DOGE", name: "Dogecoin", price: 45 },
  { symbol: "TON", name: "Toncoin", price: 70 },
  { symbol: "ADA", name: "Cardano", price: 55 }
];

export const BOARD = [
  { name: "Старт", type: "start", short: "СТАРТ" },
  { name: "Bitcoin", type: "property", asset: "BTC", price: 220, rent: 45, short: "BTC" },
  { name: "Рынок", type: "market", short: "РЫНОК" },
  { name: "Ethereum", type: "property", asset: "ETH", price: 180, rent: 36, short: "ETH" },
  { name: "Майнинг", type: "mining", short: "МАЙНИНГ" },
  { name: "Комиссия сети", type: "fee", amount: 55, short: "КОМИССИЯ" },
  { name: "Solana", type: "property", asset: "SOL", price: 160, rent: 32, short: "SOL" },
  { name: "Удачная сделка", type: "event", short: "СДЕЛКА" },
  { name: "Dogecoin", type: "property", asset: "DOGE", price: 110, rent: 22, short: "DOGE" },
  { name: "Рынок", type: "market", short: "РЫНОК" },
  { name: "Toncoin", type: "property", asset: "TON", price: 140, rent: 28, short: "TON" },
  { name: "Налог", type: "fee", amount: 75, short: "НАЛОГ" },
  { name: "Cardano", type: "property", asset: "ADA", price: 125, rent: 25, short: "ADA" },
  { name: "Майнинг", type: "mining", short: "МАЙНИНГ" },
  { name: "Bitcoin", type: "property", asset: "BTC", price: 250, rent: 52, short: "BTC +" },
  { name: "Счастливый блок", type: "event", short: "БОНУС" },
  { name: "Ethereum", type: "property", asset: "ETH", price: 210, rent: 43, short: "ETH +" },
  { name: "Рынок", type: "market", short: "РЫНОК" },
  { name: "Solana", type: "property", asset: "SOL", price: 190, rent: 40, short: "SOL +" },
  { name: "Налог на прибыль", type: "fee", amount: 65, short: "НАЛОГ" },
  { name: "Dogecoin", type: "property", asset: "DOGE", price: 130, rent: 27, short: "DOGE +" },
  { name: "Майнинг", type: "mining", short: "МАЙНИНГ" },
  { name: "Toncoin", type: "property", asset: "TON", price: 170, rent: 35, short: "TON +" },
  { name: "Счастливый блок", type: "event", short: "БОНУС" }
];

const initialMarket = () => Object.fromEntries(ASSETS.map(({ symbol, price }) => [symbol, price]));

export function createGameState(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > MAX_PLAYERS) {
    throw new Error("Для начала партии нужно от 2 до 4 игроков.");
  }
  return {
    status: "playing",
    round: 1,
    current: 0,
    phase: "rolling",
    lastRoll: null,
    landed: null,
    pendingPurchase: null,
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      cash: 1200,
      position: 0,
      holdings: {},
      miners: 0,
      farms: {},
      bankrupt: false
    })),
    market: initialMarket(),
    properties: {},
    log: ["Партия началась. У каждого игрока 1 200 USD."]
  };
}

export function netWorth(state, player) {
  const cryptoValue = Object.entries(player.holdings)
    .reduce((sum, [symbol, quantity]) => sum + (state.market[symbol] || 0) * quantity, 0);
  const propertyValue = Object.entries(state.properties)
    .filter(([, owner]) => owner === player.id)
    .reduce((sum, [position]) => sum + BOARD[Number(position)].price, 0);
  return player.cash + cryptoValue + propertyValue + player.miners * 60;
}

function log(state, message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 40);
}

function finishIfNeeded(state) {
  const active = state.players.filter((player) => !player.bankrupt);
  if (active.length <= 1 || state.round > MAX_ROUNDS) {
    state.status = "finished";
    state.phase = "finished";
    state.winner = active.length === 1
      ? active[0].id
      : state.players.reduce((best, player) =>
          !best || netWorth(state, player) > netWorth(state, best) ? player : best, null)?.id;
    if (state.round > MAX_ROUNDS) log(state, `Завершено ${MAX_ROUNDS} раундов. Победитель определяется по капиталу.`);
  }
}

function nextPlayer(state) {
  const previous = state.current;
  for (let step = 1; step <= state.players.length; step += 1) {
    const index = (previous + step) % state.players.length;
    if (!state.players[index].bankrupt) {
      state.current = index;
      if (index <= previous) state.round += 1;
      break;
    }
  }
  state.phase = "rolling";
  state.lastRoll = null;
  state.landed = null;
  state.pendingPurchase = null;
  finishIfNeeded(state);
}

function charge(state, player, amount, reason) {
  player.cash -= amount;
  if (player.cash < 0) {
    player.cash = 0;
    player.bankrupt = true;
    player.holdings = {};
    player.miners = 0;
    player.farms = {};
    for (const [position, owner] of Object.entries(state.properties)) {
      if (owner === player.id) delete state.properties[position];
    }
    log(state, `${player.name} не смог оплатить ${reason} и выбыл из игры.`);
  } else {
    log(state, `${player.name}: −${amount} USD (${reason}).`);
  }
}

function mineFarmCoins(state, player) {
  if (!player.farms || Object.keys(player.farms).length === 0) return;
  for (const [symbol, count] of Object.entries(player.farms)) {
    if (!count) continue;
    const mined = count;
    player.holdings[symbol] = (player.holdings[symbol] || 0) + mined;
    log(state, `${player.name} добыл ${mined} ${symbol} на фермах.`);
  }
}

function resolveLanding(state, player, random) {
  const tile = BOARD[player.position];
  state.landed = player.position;
  log(state, `${player.name} попал на «${tile.name}».`);

  if (tile.type === "start") {
    player.cash += 100;
    log(state, `${player.name} получил 100 USD за остановку на старте.`);
  } else if (tile.type === "property") {
    const owner = state.properties[player.position];
    if (!owner) {
      state.pendingPurchase = player.position;
      log(state, `Участок «${tile.name}» доступен за ${tile.price} USD.`);
    } else if (owner !== player.id) {
      const ownerPlayer = state.players.find((item) => item.id === owner);
      const rent = tile.rent;
      charge(state, player, rent, `аренда игроку ${ownerPlayer?.name || "банку"}`);
      if (!player.bankrupt && ownerPlayer) ownerPlayer.cash += rent;
    }
  } else if (tile.type === "fee") {
    charge(state, player, tile.amount, tile.name.toLowerCase());
  } else if (tile.type === "event") {
    const amount = 40 + Math.floor(random() * 81);
    player.cash += amount;
    log(state, `${player.name} получил ${amount} USD за ${tile.name.toLowerCase()}.`);
  }

  if (!player.bankrupt && player.miners > 0) {
    const income = player.miners * 25;
    player.cash += income;
    log(state, `${player.name} получил ${income} USD от майнинг-ферм.`);
    mineFarmCoins(state, player);
  }

  const symbol = ASSETS[Math.floor(random() * ASSETS.length)].symbol;
  const previousPrice = state.market[symbol];
  const change = Math.max(1, Math.round(previousPrice * (Math.floor(random() * 21) - 10) / 100));
  state.market[symbol] = Math.max(10, previousPrice + (random() < 0.5 ? -change : change));
  log(state, `${symbol}: новая цена ${state.market[symbol]} USD.`);
  if (player.bankrupt) finishIfNeeded(state);
}

export function applyAction(source, playerId, action, random = Math.random) {
  const state = structuredClone(source);
  if (state.status !== "playing") throw new Error("Партия уже завершена.");
  const player = state.players[state.current];
  if (player?.id !== playerId) throw new Error("Сейчас ход другого игрока.");
  if (!action || typeof action.type !== "string") throw new Error("Некорректное действие.");

  if (action.type === "roll") {
    if (state.phase !== "rolling") throw new Error("Сначала завершите текущий ход.");
    const roll = Math.floor(random() * 6) + 1;
    const oldPosition = player.position;
    player.position = (oldPosition + roll) % BOARD.length;
    if (player.position < oldPosition) {
      player.cash += 150;
      log(state, `${player.name} прошёл старт и получил 150 USD.`);
    }
    state.lastRoll = roll;
    state.phase = "decision";
    resolveLanding(state, player, random);
    return state;
  }

  if (state.phase !== "decision") throw new Error("Сначала бросьте кубик.");

  if (action.type === "buy-property" || action.type === "skip-property") {
    if (state.pendingPurchase === null) throw new Error("Сейчас нельзя купить этот участок.");
    const position = state.pendingPurchase;
    const tile = BOARD[position];
    state.pendingPurchase = null;
    if (action.type === "buy-property") {
      if (player.cash < tile.price) throw new Error("Недостаточно USD для покупки.");
      player.cash -= tile.price;
      state.properties[position] = player.id;
      log(state, `${player.name} купил участок «${tile.name}» за ${tile.price} USD.`);
    } else {
      log(state, `${player.name} отказался от участка «${tile.name}».`);
    }
  } else if (action.type === "buy-crypto" || action.type === "sell-crypto") {
    const symbol = String(action.symbol || "");
    const quantity = Number(action.quantity);
    if (!state.market[symbol] || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Выберите криптовалюту и количество от 1 до 20.");
    }
    const value = state.market[symbol] * quantity;
    if (action.type === "buy-crypto") {
      if (player.cash < value) throw new Error("Недостаточно USD для покупки.");
      player.cash -= value;
      player.holdings[symbol] = (player.holdings[symbol] || 0) + quantity;
      log(state, `${player.name} купил ${quantity} ${symbol} за ${value} USD.`);
    } else {
      if ((player.holdings[symbol] || 0) < quantity) throw new Error("Недостаточно монет для продажи.");
      player.cash += value;
      player.holdings[symbol] -= quantity;
      if (player.holdings[symbol] === 0) delete player.holdings[symbol];
      log(state, `${player.name} продал ${quantity} ${symbol} за ${value} USD.`);
    }
  } else if (action.type === "buy-miner") {
    if (BOARD[player.position].type !== "mining") throw new Error("Ферму можно расширить только на клетке «Майнинг».");
    const symbol = String(action.symbol || "BTC");
    const quantity = Number(action.quantity);
    if (!ASSETS.some((asset) => asset.symbol === symbol)) throw new Error("Укажите валюта для майнинга.");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) throw new Error("Можно купить от 1 до 5 установок.");
    const cost = quantity * 150;
    if (player.cash < cost) throw new Error("Недостаточно USD для покупки установок.");
    player.cash -= cost;
    player.miners += quantity;
    player.farms[symbol] = (player.farms[symbol] || 0) + quantity;
    log(state, `${player.name} купил ${quantity} ${symbol}-ферм за ${cost} USD.`);
  } else if (action.type === "end-turn") {
    if (state.pendingPurchase !== null) throw new Error("Купите участок или откажитесь от него.");
    log(state, `${player.name} завершил ход.`);
    nextPlayer(state);
  } else {
    throw new Error("Неизвестное действие.");
  }

  if (state.status === "playing" && state.phase === "decision" && player.bankrupt) finishIfNeeded(state);
  return state;
}
