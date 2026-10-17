import { SLOT_COUNT } from "./grill";
import type { DropTarget, Kind, Seasoning } from "../domain/types";
import { KINDS, SEASONINGS } from "../domain/types";

/**
 * Pointer Events によるドラッグ。マウスもタッチも同じコードで扱える。
 *
 * ここが受け持つのは「指がどこにあるか」「どこで離したか」まで。
 * 離した先が何かを DropTarget に変換して、あとは呼び出し側（main）に渡す。
 * ドメインの関数はここからは一切呼ばない。
 */

/** 動いたと見なす距離（px）。これ未満ならクリック扱いにして flip に回す */
const DRAG_THRESHOLD = 6;

type DragState = {
  readonly id: string;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  /** 生串の箱から直接引っ張り出した場合。離す場所がなければ串ごと消す */
  readonly fromBin: boolean;
};

type DragHandlers = {
  /** 既にある串をつかんだ */
  readonly onGrabSkewer: (id: string) => HTMLElement | undefined;
  /** 生串の箱をつかんだ。新しい串を作って DOM を返す */
  readonly onGrabBin: (kind: Kind) => { readonly id: string; readonly el: HTMLElement } | undefined;
  /** 動かさずに離した（クリック） */
  readonly onTap: (id: string) => void;
  /** ドロップした */
  readonly onDrop: (id: string, to: DropTarget, fromBin: boolean) => void;
};

class Drag {
  private state: DragState | null = null;

  constructor(
    private readonly dragLayer: HTMLElement,
    private readonly bed: HTMLElement,
    private readonly handlers: DragHandlers,
    /** 焼き台の空きスロットを調べる。自分自身は除外する */
    private readonly occupiedSlots: (exceptId: string) => ReadonlySet<number>,
  ) {}

  start(): void {
    document.addEventListener("pointerdown", (ev) => this.onPointerDown(ev));
    window.addEventListener("pointermove", (ev) => this.onPointerMove(ev));
    window.addEventListener("pointerup", (ev) => this.onPointerEnd(ev, false));
    window.addEventListener("pointercancel", (ev) => this.onPointerEnd(ev, true));
  }

  /** 離した位置が何の上かを調べて DropTarget に変換する */
  findTarget(x: number, y: number, exceptId: string): DropTarget {
    for (const node of document.elementsFromPoint(x, y)) {
      if (!(node instanceof HTMLElement)) continue;
      const zoneEl = node.closest<HTMLElement>("[data-zone]");
      if (!zoneEl) continue;
      const zone = zoneEl.dataset["zone"];

      if (zone === "grill") {
        const slot = this.slotFromPoint(x, exceptId);
        // 空きがないときは「どこでもない」扱いにして元の場所へ戻す
        return slot === null ? { target: "none" } : { target: "grill", slot };
      }
      if (zone === "board") return { target: "board" };
      if (zone === "trash") return { target: "trash" };
      if (zone === "cat") return { target: "cat" };
      if (zone === "order") {
        const orderId = zoneEl.dataset["orderId"];
        if (orderId) return { target: "order", orderId };
        continue;
      }
      // data-zone="salt" / "sauce" は味付け。Seasoning かどうかを値の一覧で確かめる。
      // ここで KINDS / SEASONINGS を使っているのは、文字列を直接書くと
      // 種類を増やしたときに取りこぼすため。
      const seasoning = SEASONINGS.find((s): s is Seasoning => s === zone);
      if (seasoning) return { target: "season", seasoning };
    }
    return { target: "none" };
  }

  /** 画面の x 座標から、焼き台の空いているスロットを選ぶ。近い順に探す */
  private slotFromPoint(x: number, exceptId: string): number | null {
    const rect = this.bed.getBoundingClientRect();
    const raw = Math.floor(((x - rect.left) / rect.width) * SLOT_COUNT);
    const want = Math.max(0, Math.min(SLOT_COUNT - 1, raw));
    const taken = this.occupiedSlots(exceptId);
    for (let distance = 0; distance < SLOT_COUNT; distance++) {
      for (const candidate of [want - distance, want + distance]) {
        if (candidate >= 0 && candidate < SLOT_COUNT && !taken.has(candidate)) return candidate;
      }
    }
    return null;
  }

  private onPointerDown(ev: PointerEvent): void {
    if (this.state) return;
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const skewerEl = target.closest<HTMLElement>(".skewer");
    if (skewerEl && !skewerEl.closest("#bins")) {
      const id = skewerEl.dataset["id"];
      if (!id) return;
      if (!this.handlers.onGrabSkewer(id)) return;
      ev.preventDefault();
      this.state = this.newState(id, ev, false);
      return;
    }

    const binEl = target.closest<HTMLElement>(".bin");
    const kind = KINDS.find((k): k is Kind => k === binEl?.dataset["kind"]);
    if (!kind) return;
    const created = this.handlers.onGrabBin(kind);
    if (!created) return;
    ev.preventDefault();
    this.state = this.newState(created.id, ev, true);
    // 箱から出した串は最初から持ち上がった状態にする
    this.state.moved = true;
    this.lift(created.el, ev.clientX, ev.clientY);
  }

  private newState(id: string, ev: PointerEvent, fromBin: boolean): DragState {
    return {
      id,
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      offsetX: 0,
      offsetY: 0,
      moved: false,
      fromBin,
    };
  }

  private onPointerMove(ev: PointerEvent): void {
    const state = this.state;
    if (!state || ev.pointerId !== state.pointerId) return;
    const el = this.handlers.onGrabSkewer(state.id);
    if (!el) return;

    if (!state.moved) {
      // 指が少し揺れただけならクリック扱いのままにする
      if (Math.hypot(ev.clientX - state.startX, ev.clientY - state.startY) < DRAG_THRESHOLD) return;
      state.moved = true;
      this.lift(el, ev.clientX, ev.clientY);
      return;
    }
    this.move(el, ev.clientX, ev.clientY, state.id);
  }

  private onPointerEnd(ev: PointerEvent, cancelled: boolean): void {
    const state = this.state;
    if (!state || ev.pointerId !== state.pointerId) return;
    this.state = null;

    const el = this.handlers.onGrabSkewer(state.id);
    if (!el) return;

    if (!state.moved) {
      this.handlers.onTap(state.id);
      return;
    }

    el.classList.remove("dragging");
    clearHighlight();
    // 型注釈を付けておけば { target: "none" } が DropTarget として推論されるので、
    // as const で型を狭め直す必要がない。
    const to: DropTarget = cancelled ? { target: "none" } : this.findTarget(ev.clientX, ev.clientY, state.id);
    this.handlers.onDrop(state.id, to, state.fromBin);
  }

  /** 串を掴み上げてドラッグ用のレイヤーに移す */
  private lift(el: HTMLElement, x: number, y: number): void {
    const state = this.state;
    if (!state) return;
    const rect = el.getBoundingClientRect();
    state.offsetX = state.fromBin ? rect.width / 2 : x - rect.left;
    state.offsetY = state.fromBin ? rect.height * 0.3 : y - rect.top;
    this.dragLayer.append(el);
    el.classList.add("dragging");
    this.move(el, x, y, state.id);
  }

  private move(el: HTMLElement, x: number, y: number, id: string): void {
    const state = this.state;
    if (!state) return;
    el.style.left = `${x - state.offsetX}px`;
    el.style.top = `${y - state.offsetY}px`;
    highlight(this.findTarget(x, y, id));
  }
}

/** ドロップ先を光らせる */
function highlight(to: DropTarget): void {
  clearHighlight();
  const selector = selectorFor(to);
  if (selector) document.querySelector(selector)?.classList.add("drop-hover");
}

function clearHighlight(): void {
  for (const el of Array.from(document.querySelectorAll(".drop-hover"))) {
    el.classList.remove("drop-hover");
  }
}

function selectorFor(to: DropTarget): string | null {
  switch (to.target) {
    case "grill":
      return "#grill";
    case "board":
      return "#board";
    case "season":
      return `[data-zone="${to.seasoning}"]`;
    case "trash":
      return `[data-zone="trash"]`;
    case "cat":
      return `[data-zone="cat"]`;
    case "order":
      return `[data-order-id="${to.orderId}"]`;
    case "none":
      return null;
  }
}

export { Drag, clearHighlight };
export type { DragHandlers };
