export interface PlayerInput {
  seq: number;
  targetX: number;
  targetY: number;
}

export interface SpawnUnitMessage {
  kind: string;
}

export interface BuildStructureMessage {
  kind: string;
  /** World-space target. Server snaps to STRUCTURE_GRID_SNAP. */
  x: number;
  y: number;
}

export interface RecycleStructureMessage {
  /** Schema id of the structure being recycled. Server validates ownership. */
  id: string;
}
