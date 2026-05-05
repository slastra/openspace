import type { Application } from "pixi.js";

export interface InputState {
  /** Cursor position in CSS pixels relative to the canvas. */
  screenX: number;
  screenY: number;
  /** Whether the cursor is currently over the canvas. */
  active: boolean;
  /**
   * Subscribe to a single key tap. `key` is matched against `KeyboardEvent.code`
   * (e.g. "KeyT", "Space") so behavior is layout-independent. Returns an
   * unsubscribe function. Auto-repeat presses are filtered.
   */
  onKeyTap(key: string, handler: () => void): () => void;
  /** Fires once when the key is released. Pair with onKeyTap for hold-to-act. */
  onKeyUp(key: string, handler: () => void): () => void;
  /** True while `key` (KeyboardEvent.code) is currently held. Used by the
   *  per-frame loop for repeat-on-hold behaviors (e.g. unit spawn). */
  isKeyDown(key: string): boolean;
  /**
   * Subscribe to a primary-button click on the canvas. Handler receives the
   * cursor position in CSS pixels relative to the canvas. Returns an
   * unsubscribe function.
   */
  onClick(handler: (x: number, y: number) => void): () => void;
  /**
   * Subscribe to a secondary-button (right) click on the canvas. The browser
   * context menu is suppressed automatically while at least one handler is
   * registered, so the click acts as a "cancel" gesture in-game.
   */
  onRightClick(handler: () => void): () => void;
  /**
   * Subscribe to right-button pointer-DOWN with cursor position. Distinct
   * from `onRightClick` (which is also fired by the same event) — used by
   * the radial emote menu to open at the click point. Cancel-mode and
   * emote-menu-open both fire on the same event without conflicting:
   * cancel closes any active build mode; menu opens; on release without
   * drag the menu closes silently.
   */
  onRightDown(handler: (x: number, y: number) => void): () => void;
}

export function createInput(app: Application): InputState {
  const canvas = app.canvas;

  const tapHandlers = new Map<string, Set<() => void>>();
  const upHandlers = new Map<string, Set<() => void>>();
  const downKeys = new Set<string>();
  const clickHandlers = new Set<(x: number, y: number) => void>();
  const rightClickHandlers = new Set<() => void>();
  const rightDownHandlers = new Set<(x: number, y: number) => void>();

  const onMove = (ev: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    state.screenX = ev.clientX - rect.left;
    state.screenY = ev.clientY - rect.top;
    state.active = true;
  };
  const onLeave = () => {
    state.active = false;
  };
  const onEnter = () => {
    state.active = true;
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.repeat) return;
    downKeys.add(ev.code);
    const subs = tapHandlers.get(ev.code);
    if (!subs) return;
    for (const fn of subs) fn();
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    downKeys.delete(ev.code);
    const subs = upHandlers.get(ev.code);
    if (!subs) return;
    for (const fn of subs) fn();
  };

  const onClick = (ev: PointerEvent) => {
    if (ev.button === 0) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      for (const fn of clickHandlers) fn(x, y);
    } else if (ev.button === 2) {
      for (const fn of rightClickHandlers) fn();
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      for (const fn of rightDownHandlers) fn(x, y);
    }
  };
  // Suppress the browser context menu so right-click can be used as a
  // cancel gesture without a popup interrupting the player.
  const onContextMenu = (ev: MouseEvent) => ev.preventDefault();

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerenter", onEnter);
  canvas.addEventListener("pointerdown", onClick);
  canvas.addEventListener("contextmenu", onContextMenu);
  // Listen on window so the page doesn't need focus on the canvas itself.
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  // Browser drops keyup if focus leaves while a key is held — fire any
  // registered onKeyUp handlers on blur to keep dash-style holds from
  // getting stuck "down" when the user tabs away.
  window.addEventListener("blur", () => {
    downKeys.clear();
    for (const subs of upHandlers.values()) for (const fn of subs) fn();
  });

  const state: InputState = {
    screenX: 0,
    screenY: 0,
    active: false,
    onKeyTap(key, handler) {
      let subs = tapHandlers.get(key);
      if (!subs) {
        subs = new Set();
        tapHandlers.set(key, subs);
      }
      subs.add(handler);
      return () => subs?.delete(handler);
    },
    onKeyUp(key, handler) {
      let subs = upHandlers.get(key);
      if (!subs) {
        subs = new Set();
        upHandlers.set(key, subs);
      }
      subs.add(handler);
      return () => subs?.delete(handler);
    },
    onClick(handler) {
      clickHandlers.add(handler);
      return () => clickHandlers.delete(handler);
    },
    onRightClick(handler) {
      rightClickHandlers.add(handler);
      return () => rightClickHandlers.delete(handler);
    },
    onRightDown(handler) {
      rightDownHandlers.add(handler);
      return () => rightDownHandlers.delete(handler);
    },
    isKeyDown(key) {
      return downKeys.has(key);
    },
  };
  return state;
}
