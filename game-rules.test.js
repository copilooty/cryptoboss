import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, createGameState, MAX_ROUNDS, netWorth } from "./game-rules.js";

const players = [{ id: "a", name: "Али" }, { id: "b", name: "Друг" }];

function fixedRandom(value) {
  return () => value;
}

test("starts a two-player game with cash and a rolling phase", () => {
  const game = createGameState(players);
  assert.equal(game.players[0].cash, 1200);
  assert.equal(game.players[1].cash, 1200);
  assert.equal(game.phase, "rolling");
});

test("does not allow another player to act out of turn", () => {
  assert.throws(() => applyAction(createGameState(players), "b", { type: "roll" }), /ход другого игрока/);
});

test("passing and stopping on start both award their bonuses", () => {
  const game = createGameState(players);
  game.players[0].position = 23;
  const landed = applyAction(game, "a", { type: "roll" }, fixedRandom(0));
  assert.equal(landed.players[0].position, 0);
  assert.equal(landed.players[0].cash, 1450);
  assert.equal(landed.pendingPurchase, null);
});

test("a purchased property charges rent on an opponent landing", () => {
  let game = createGameState(players);
  game = applyAction(game, "a", { type: "roll" }, fixedRandom(0));
  assert.equal(game.pendingPurchase, 1);
  game = applyAction(game, "a", { type: "buy-property" });
  game = applyAction(game, "a", { type: "end-turn" });
  game.players[1].position = 20;
  game = applyAction(game, "b", { type: "roll" }, fixedRandom(0.67));
  assert.equal(game.players[1].cash, 1305);
  assert.equal(game.players[0].cash, 1025);
});

test("crypto trades require funds and cannot sell more than the wallet contains", () => {
  let game = createGameState(players);
  game.phase = "decision";
  game = applyAction(game, "a", { type: "buy-crypto", symbol: "BTC", quantity: 2 });
  assert.equal(game.players[0].holdings.BTC, 2);
  assert.equal(game.players[0].cash, 840);
  assert.throws(
    () => applyAction(game, "a", { type: "sell-crypto", symbol: "BTC", quantity: 3 }),
    /Недостаточно монет/
  );
});

test("a mining upgrade earns income and contributes to net worth", () => {
  let game = createGameState(players);
  game.phase = "decision";
  game.players[0].position = 4;
  game = applyAction(game, "a", { type: "buy-miner", quantity: 2 });
  assert.equal(game.players[0].miners, 2);
  assert.equal(netWorth(game, game.players[0]), 1020);
});

test("the game ends after the final round and picks the richest player", () => {
  let game = createGameState(players);
  game.round = MAX_ROUNDS;
  game.current = 1;
  game.phase = "decision";
  game = applyAction(game, "b", { type: "end-turn" });
  assert.equal(game.status, "finished");
  assert.equal(game.winner, "a");
});
