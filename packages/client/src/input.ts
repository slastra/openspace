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
  /** Press / release a key from on-screen UI (build cards, touch buttons).
   *  Runs exactly the keyboard path, so holds and taps behave the same. */
  press(key: string): void;
  release(key: string): void;
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
  /** Two-finger pinch on a touch screen: `factor` > 1 spreads (zoom in). */
  onPinch(handler: (factor: number) => void): () => void;
  /** Touch only: when true, lifting a finger always counts as a click at
   *  the lift point (placement mode: drag the ghost, lift to place). When
   *  false only a short tap clicks, so steering drags don't select things. */
  releaseClicks: boolean;
}

/** A touch that lasts less than this and moves less than TAP_SLOP_PX is a tap. */
const TAP_MAX_MS = 260;
const TAP_SLOP_PX = 14;

export function createInput(app: Application): InputState {
  const canvas = app.canvas;

  const tapHandlers = new Map<string, Set<() => void>>();
  const upHandlers = new Map<string, Set<() => void>>();
  const downKeys = new Set<string>();
  const clickHandlers = new Set<(x: number, y: number) => void>();
  const rightClickHandlers = new Set<() => void>();
  const rightDownHandlers = new Set<(x: number, y: number) => void>();
  const pinchHandlers = new Set<(factor: number) => void>();

  // Touch: the first finger steers (like the mouse cursor) while held; a
  // quick tap is a click; two fingers pinch-zoom and pause steering.
  interface Touch {
    x: number;
    y: number;
    startX: number;
    startY: number;
    startAt: number;
  }
  const touches = new Map<number, Touch>();
  let steerId: number | null = null;
  let pinchDist = 0;

  const local = (ev: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const fireClick = (x: number, y: number) => {
    for (const fn of clickHandlers) fn(x, y);
  };
  const pinchSpan = () => {
    const [a, b] = [...touches.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onTouchDown = (ev: PointerEvent) => {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    const p = local(ev);
    touches.set(ev.pointerId, { ...p, startX: p.x, startY: p.y, startAt: performance.now() });
    if (touches.size === 1) {
      steerId = ev.pointerId;
      state.screenX = p.x;
      state.screenY = p.y;
      state.active = true;
    } else if (touches.size === 2) {
      steerId = null;
      state.active = false;
      pinchDist = pinchSpan();
    }
  };
  const onTouchMove = (ev: PointerEvent) => {
    const t = touches.get(ev.pointerId);
    if (!t) return;
    const p = local(ev);
    t.x = p.x;
    t.y = p.y;
    if (touches.size >= 2) {
      const d = pinchSpan();
      if (pinchDist > 0 && d > 0) for (const fn of pinchHandlers) fn(d / pinchDist);
      pinchDist = d;
    } else if (ev.pointerId === steerId) {
      state.screenX = p.x;
      state.screenY = p.y;
      state.active = true;
    }
  };
  const onTouchUp = (ev: PointerEvent) => {
    const t = touches.get(ev.pointerId);
    if (!t) return;
    touches.delete(ev.pointerId);
    const wasSteer = ev.pointerId === steerId;
    if (wasSteer) {
      steerId = null;
      state.active = false;
      const quick =
        performance.now() - t.startAt < TAP_MAX_MS &&
        Math.hypot(t.x - t.startX, t.y - t.startY) < TAP_SLOP_PX;
      if (ev.type === "pointerup" && (quick || state.releaseClicks)) fireClick(t.x, t.y);
    }
    if (touches.size < 2) pinchDist = 0;
    // Lifting one finger of a pinch hands steering back to the other.
    if (touches.size === 1 && steerId === null) {
      const [id, rest] = [...touches.entries()][0]!;
      steerId = id;
      rest.startAt = 0; // never a tap
      state.screenX = rest.x;
      state.screenY = rest.y;
      state.active = true;
    }
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerType === "touch") return onTouchMove(ev);
    const p = local(ev);
    state.screenX = p.x;
    state.screenY = p.y;
    state.active = true;
  };
  const onLeave = (ev: PointerEvent) => {
    if (ev.pointerType === "touch") return;
    state.active = false;
  };
  const onEnter = (ev: PointerEvent) => {
    if (ev.pointerType === "touch") return;
    state.active = true;
  };
  const pressKey = (code: string) => {
    if (downKeys.has(code)) return;
    downKeys.add(code);
    const subs = tapHandlers.get(code);
    if (!subs) return;
    for (const fn of subs) fn();
  };
  const releaseKey = (code: string) => {
    if (!downKeys.delete(code)) return;
    const subs = upHandlers.get(code);
    if (!subs) return;
    for (const fn of subs) fn();
  };
  const isTyping = (ev: KeyboardEvent) =>
    ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement;
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.repeat || isTyping(ev)) return;
    pressKey(ev.code);
  };
  const onKeyUp = (ev: KeyboardEvent) => {
    releaseKey(ev.code);
  };

  const onClick = (ev: PointerEvent) => {
    if (ev.pointerType === "touch") return onTouchDown(ev);
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
  canvas.addEventListener("pointerup", onTouchUp);
  canvas.addEventListener("pointercancel", onTouchUp);
  // No browser panning/zooming/scrolling over the game.
  canvas.style.touchAction = "none";
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
    press: pressKey,
    release: releaseKey,
    onPinch(handler) {
      pinchHandlers.add(handler);
      return () => pinchHandlers.delete(handler);
    },
    releaseClicks: false,
  };
  return state;
}
