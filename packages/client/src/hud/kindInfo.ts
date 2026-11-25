import { STRUCTURE_KIND_META, UNIT_KIND_META } from "@openspace/shared";

/** One-line role blurb plus a few stat chips for a build card tooltip. */
export interface KindInfo {
  blurb: string;
  stats: [label: string, value: string][];
}

const BLURBS: Record<string, string> = {
  base: "Your home. Required to spawn units, respawn point, and blocks enemy building nearby. Free, one per pilot.",
  supply: "Raises your supply cap so you can field more units.",
  turret: "Fires a laser at the nearest enemy in range.",
  wall: "Tough barrier. Your own ship and drones pass through it; enemies don't.",
  medbay: "Heals everything you own nearby: ships, drones and buildings. Two per pilot.",
  rammer: "Cheap kamikaze. Charges enemies and explodes on death, damaging everything around it.",
  miner: "Ignores fights and mines asteroids for minerals.",
  gunner: "Fires projectiles at range. Shots can be dodged at long range.",
  laser: "Long-range beam with high damage. Fragile up close.",
  repair: "Heals the nearest damaged friendly with a tether beam.",
  shielder: "Projects a shield aura that soaks damage for friendlies in range.",
};

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function kindInfo(kind: string): KindInfo {
  const blurb = BLURBS[kind] ?? "";
  const u = UNIT_KIND_META[kind];
  if (u) {
    const stats: KindInfo["stats"] = [
      ["HP", fmt(u.maxHp)],
      ["Supply", fmt(u.supplyCost)],
      ["Speed", fmt(u.attackSpeed)],
    ];
    if (u.abilityDamage && u.abilityCooldownSeconds) {
      stats.push(["DPS", fmt(u.abilityDamage / u.abilityCooldownSeconds)]);
    }
    if (u.abilityRange) stats.push(["Range", fmt(u.abilityRange)]);
    if (u.explodeDamage) stats.push(["Blast", fmt(u.explodeDamage)]);
    if (u.miningDps) stats.push(["Mining/s", fmt(u.miningDps)]);
    if (u.repairHps) stats.push(["Heal/s", fmt(u.repairHps)]);
    if (u.shieldGrant) stats.push(["Shield", fmt(u.shieldGrant)]);
    return { blurb, stats };
  }
  const s = STRUCTURE_KIND_META[kind];
  if (!s) return { blurb, stats: [] };
  const stats: KindInfo["stats"] = [["HP", fmt(s.hp)]];
  if (s.supplyContribution) stats.push(["Supply", `+${s.supplyContribution}`]);
  if (s.abilityDamage && s.abilityCooldownSeconds) {
    stats.push(["DPS", fmt(s.abilityDamage / s.abilityCooldownSeconds)]);
  }
  if (s.abilityRange) stats.push(["Range", fmt(s.abilityRange)]);
  if (s.healHps) stats.push(["Heal/s", fmt(s.healHps)]);
  if (s.maxPerPlayer) stats.push(["Max", fmt(s.maxPerPlayer)]);
  return { blurb, stats };
}
