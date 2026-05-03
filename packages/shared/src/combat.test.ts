import { describe, expect, it } from "vitest";
import {
  PLAYER_KIND,
  allCombatants,
  applyDamage,
  contactRadiusOf,
  isUnit,
  lookupCombatant,
  nearestEnemy,
  teamOf,
} from "./combat.js";
import { ArenaState, Player, Unit } from "./schema.js";

function makePlayer(id: string, x: number, y: number, hp = 100, shield = 0): Player {
  const p = new Player();
  p.id = id;
  p.x = x;
  p.y = y;
  p.hp = hp;
  p.maxHp = hp;
  p.shield = shield;
  p.maxShield = shield;
  return p;
}

function makeUnit(id: string, ownerId: string, kind: string, x: number, y: number, hp = 30, shield = 0): Unit {
  const u = new Unit();
  u.id = id;
  u.ownerId = ownerId;
  u.kind = kind;
  u.x = x;
  u.y = y;
  u.hp = hp;
  u.maxHp = hp;
  u.shield = shield;
  u.maxShield = shield;
  return u;
}

describe("isUnit / teamOf / contactRadiusOf", () => {
  it("Player has kind 'player'; isUnit is false", () => {
    const p = makePlayer("p1", 0, 0);
    expect(p.kind).toBe(PLAYER_KIND);
    expect(isUnit(p)).toBe(false);
  });

  it("Unit has non-player kind; isUnit is true", () => {
    const u = makeUnit("u1", "p1", "rammer", 0, 0);
    expect(isUnit(u)).toBe(true);
  });

  it("teamOf is the player's id, or the unit's ownerId", () => {
    const p = makePlayer("p1", 0, 0);
    const u = makeUnit("u1", "p1", "rammer", 0, 0);
    expect(teamOf(p)).toBe("p1");
    expect(teamOf(u)).toBe("p1");
  });

  it("contactRadiusOf reads from kind meta for units; constant for players", () => {
    const p = makePlayer("p1", 0, 0);
    const u = makeUnit("u1", "p1", "rammer", 0, 0);
    expect(contactRadiusOf(p)).toBeGreaterThan(0);
    expect(contactRadiusOf(u)).toBeGreaterThan(0);
  });
});

describe("applyDamage", () => {
  it("drains shield first, then HP", () => {
    const p = makePlayer("p1", 0, 0, 100, 30);
    const absorbed = applyDamage(p, 50);
    expect(absorbed).toBe(50);
    expect(p.shield).toBe(0);
    expect(p.hp).toBe(80);
  });

  it("leaves HP untouched when damage is fully shield-absorbed", () => {
    const p = makePlayer("p1", 0, 0, 100, 30);
    applyDamage(p, 20);
    expect(p.shield).toBe(10);
    expect(p.hp).toBe(100);
  });

  it("clamps HP at 0", () => {
    const u = makeUnit("u1", "p1", "rammer", 0, 0, 30, 0);
    applyDamage(u, 999);
    expect(u.hp).toBe(0);
  });

  it("ignores non-positive damage", () => {
    const p = makePlayer("p1", 0, 0, 100, 30);
    expect(applyDamage(p, 0)).toBe(0);
    expect(applyDamage(p, -50)).toBe(0);
    expect(p.hp).toBe(100);
    expect(p.shield).toBe(30);
  });
});

describe("nearestEnemy", () => {
  function setup(): ArenaState {
    const state = new ArenaState();
    // p1 at origin (we'll be searching enemies from p1's team)
    state.players.set("p1", makePlayer("p1", 0, 0));
    // p2 enemy at (100, 0)
    state.players.set("p2", makePlayer("p2", 100, 0));
    // p3 enemy at (300, 0)
    state.players.set("p3", makePlayer("p3", 300, 0));
    // u1 friendly to p1 at (50, 0) — should be skipped
    state.units.set("u1", makeUnit("u1", "p1", "rammer", 50, 0));
    // u2 enemy at (200, 0)
    state.units.set("u2", makeUnit("u2", "p2", "rammer", 200, 0));
    // u3 dead enemy at (10, 0) — should be skipped
    const u3 = makeUnit("u3", "p2", "rammer", 10, 0, 30);
    u3.hp = 0;
    state.units.set("u3", u3);
    return state;
  }

  it("returns the closest enemy across players and units", () => {
    const state = setup();
    const result = nearestEnemy(state, "p1", 0, 0, 1000);
    expect(result?.id).toBe("p2"); // closer than u2 and p3
  });

  it("skips friendlies (same team)", () => {
    const state = setup();
    const result = nearestEnemy(state, "p1", 50, 0, 5);
    // Within 5 units, only u1 is a friendly. Should return null.
    expect(result).toBeNull();
  });

  it("skips dead combatants", () => {
    const state = setup();
    const result = nearestEnemy(state, "p1", 0, 0, 15);
    // u3 (dead) is at distance 10, would be closest if alive. Should return null.
    expect(result).toBeNull();
  });

  it("respects the search radius", () => {
    const state = setup();
    expect(nearestEnemy(state, "p1", 0, 0, 50)).toBeNull(); // p2 is at 100
    expect(nearestEnemy(state, "p1", 0, 0, 150)?.id).toBe("p2");
  });
});

describe("lookupCombatant + allCombatants", () => {
  it("looks up by id across both players and units", () => {
    const state = new ArenaState();
    state.players.set("p1", makePlayer("p1", 0, 0));
    state.units.set("u1", makeUnit("u1", "p1", "rammer", 5, 5));
    expect(lookupCombatant(state, "p1")?.id).toBe("p1");
    expect(lookupCombatant(state, "u1")?.id).toBe("u1");
    expect(lookupCombatant(state, "missing")).toBeNull();
  });

  it("allCombatants iterates players, units, and structures", () => {
    const state = new ArenaState();
    state.players.set("p1", makePlayer("p1", 0, 0));
    state.units.set("u1", makeUnit("u1", "p1", "rammer", 5, 5));
    const ids = Array.from(allCombatants(state), (c) => c.id);
    expect(ids).toEqual(["p1", "u1"]);
  });
});
