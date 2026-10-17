import { createRaw, tick, flip, typeName, isGrillable, placeOnGrill } from "./domain/skewer";
import { randomOrder } from "./domain/orders";
import { KINDS } from "./domain/types";
import type { DropTarget, Order, Skewer } from "./domain/types";

import { Sound } from "./ui/audio";
import { GrillCanvas, heatOfSlot, SLOT_COUNT } from "./ui/grill";
import { Drag } from "./ui/drag";
import {
  KIND_LABEL,
  buildSkewerEl,
  renderSkewer,
  renderOrders,
  renderTypeView,
  escapeHtml,
} from "./ui/render";

/**
 * 起動とゲームループ。
 *
 * ⚠️ フェーズ4時点の暫定。ゲームの状態（スコア・注文・時間）は計画では
 * src/game/state.ts が持つことになっている。ドロップの処理も src/game/drop.ts の
 * drop(skewer, to) に移す。いまは drop() が未実装なので、
 * handleDrop() が「未実装」とログに出して串を元に戻すだけにしてある。
 * フェーズ5ではそこを drop() の呼び出しに差し替える。
 */

const ROUND_SECONDS = 150;
const MAX_ORDERS = 3;

/** 画面に出ている串 1 本ぶんの情報。DOM とドメインの値をつなぐ */
type Entity = {
  skewer: Skewer;
  readonly el: HTMLElement;
  zone: "grill" | "board";
  /** 焼き台の何番目か。まな板の上なら null */
  slot: number | null;
};

const entities = new Map<string, Entity>();
let selectedId: string | null = null;

/**
 * ゲーム全体の状態。フェーズ6で src/game/state.ts に移す予定。
 *
 * 型を書き出しておくと、orders の空配列に as Order[] を付けずに済む。
 */
type GameState = {
  running: boolean;
  timeLeft: number;
  score: number;
  served: number;
  missed: number;
  typeErrors: number;
  catFed: number;
  orders: Order[];
  nextOrderAt: number;
};

const game: GameState = {
  running: false,
  timeLeft: ROUND_SECONDS,
  score: 0,
  served: 0,
  missed: 0,
  typeErrors: 0,
  catFed: 0,
  orders: [],
  nextOrderAt: 0,
};

function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`要素が見つかりません: ${selector}`);
  return el;
}

function $canvas(selector: string): HTMLCanvasElement {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLCanvasElement)) throw new Error(`canvas が見つかりません: ${selector}`);
  return el;
}

const dom = {
  bed: $("#grill-bed"),
  board: $("#board-items"),
  bins: $("#bins"),
  orders: $("#orders"),
  dragLayer: $("#drag-layer"),
  typeCode: $("#type-code"),
  typeActions: $("#type-actions"),
  log: $("#log"),
  time: $("#time"),
  score: $("#score"),
  mute: $("#mute"),
  heatScale: $("#heat-scale"),
  toast: $("#toast"),
  start: $("#start-overlay"),
  startBtn: $("#start-btn"),
  end: $("#end-overlay"),
  endStats: $("#end-stats"),
  againBtn: $("#again-btn"),
};

const sound = new Sound();
const grillCanvas = new GrillCanvas($canvas("#coals"), $canvas("#smoke"));
// 猫のリアクション（src/ui/cat.ts）はフェーズ5でドロップ処理を書くときに繋ぐ。
// catRefusal() の結果を受け取って喜んだり嫌がったりする役。

// ---------- ログ ----------

type LogKind = "ok" | "error" | "info";
let toastTimer = 0;

function log(kind: LogKind, code: string, note?: string): void {
  const li = document.createElement("li");
  li.className = `log-${kind}`;
  const codeEl = document.createElement("code");
  codeEl.textContent = code;
  li.append(codeEl);
  if (note) {
    const noteEl = document.createElement("span");
    noteEl.className = "note";
    noteEl.textContent = note;
    li.append(noteEl);
  }
  dom.log.prepend(li);
  while (dom.log.children.length > 7) dom.log.lastElementChild?.remove();

  dom.toast.textContent = code;
  dom.toast.className = `toast toast-${kind} show`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => dom.toast.classList.remove("show"), 2600);
}

// ---------- 画面の置き場所 ----------

function putOnGrill(entity: Entity, slot: number): void {
  entity.zone = "grill";
  entity.slot = slot;
  entity.el.style.left = `${((slot + 0.5) / SLOT_COUNT) * 100}%`;
  entity.el.style.top = "";
  dom.bed.append(entity.el);
  renderEntity(entity);
}

function putOnBoard(entity: Entity): void {
  entity.zone = "board";
  entity.slot = null;
  entity.el.style.left = "";
  entity.el.style.top = "";
  dom.board.append(entity.el);
  renderEntity(entity);
}

function renderEntity(entity: Entity): void {
  renderSkewer(entity.el, entity.skewer, entity.skewer.id === selectedId);
}

function select(id: string | null): void {
  selectedId = id;
  for (const entity of entities.values()) renderEntity(entity);
  renderTypeView(dom.typeCode, dom.typeActions, id ? entities.get(id)?.skewer : undefined);
}

function occupiedSlots(exceptId: string): ReadonlySet<number> {
  const set = new Set<number>();
  for (const entity of entities.values()) {
    if (entity.zone === "grill" && entity.slot !== null && entity.skewer.id !== exceptId) {
      set.add(entity.slot);
    }
  }
  return set;
}

// ---------- ドラッグ ----------

const drag = new Drag(
  dom.dragLayer,
  dom.bed,
  {
    onGrabSkewer: (id) => {
      const entity = entities.get(id);
      if (!entity || !game.running) return undefined;
      sound.init();
      select(id);
      return entity.el;
    },
    onGrabBin: (kind) => {
      if (!game.running) return undefined;
      sound.init();
      const skewer = createRaw(kind);
      const el = buildSkewerEl(skewer);
      const entity: Entity = { skewer, el, zone: "board", slot: null };
      entities.set(skewer.id, entity);
      renderEntity(entity);
      select(skewer.id);
      return { id: skewer.id, el };
    },
    onTap: (id) => {
      // 焼き台の上の串をクリックしたらひっくり返す。
      // flip は DropTarget を持たない唯一の操作なので、ここで直接呼ぶ。
      const entity = entities.get(id);
      if (!entity || entity.skewer.status !== "grilling") return;
      entity.skewer = flip(entity.skewer);
      entity.el.classList.remove("flipping");
      void entity.el.offsetWidth;
      entity.el.classList.add("flipping");
      sound.flip();
      renderEntity(entity);
      select(id);
      log("ok", `flip(skewer) → ${typeName(entity.skewer)}`, `${entity.skewer.facing === "front" ? "表" : "裏"}が下`);
    },
    onDrop: (id, to, fromBin) => handleDrop(id, to, fromBin),
  },
  occupiedSlots,
);

/**
 * ⚠️ フェーズ5でここを src/game/drop.ts の drop(skewer, to) 呼び出しに差し替える。
 *
 * いまは串を元の場所に戻して、どのドロップ先だったかをログに出すだけ。
 * 計画のフェーズ4の完了条件が「ドロップ以外の操作が画面で動く」なので、
 * ここで線を引いてある。
 */
function handleDrop(id: string, to: DropTarget, fromBin: boolean): void {
  const entity = entities.get(id);
  if (!entity) return;

  if (to.target === "none") {
    if (fromBin) {
      entities.delete(id);
      entity.el.remove();
      if (selectedId === id) select(null);
      return;
    }
    returnToOrigin(entity);
    return;
  }

  // 焼き台だけ先に繋いである。フェーズ4の完了条件が「焼ける様子が画面で動く」なので、
  // 串が焼き台に乗らないと tick も flip も確かめられないため。
  // フェーズ5で drop() を書いたら、この分岐ごと drop() の呼び出しに置き換える。
  if (to.target === "grill") {
    const skewer = entity.skewer;
    if (skewer.status === "grilling") {
      // すでに焼いている串を別の枠へ動かすだけ。状態は変わらない
      putOnGrill(entity, to.slot);
      return;
    }
    if (isGrillable(skewer)) {
      entity.skewer = placeOnGrill(skewer);
      log("ok", `placeOnGrill(skewer: ${typeName(skewer)}) → Grilling`);
      putOnGrill(entity, to.slot);
      select(entity.skewer.id);
      return;
    }
    typeError(skewer, "placeOnGrill", "Grillable", "焼き台に置けるのは Raw | Undercooked だけ");
    returnToOrigin(entity);
    return;
  }

  log("info", `// drop(skewer, { target: "${to.target}" }) は未実装です`, "フェーズ5で src/game/drop.ts を書くと動きます");
  if (fromBin) {
    putOnBoard(entity);
    return;
  }
  returnToOrigin(entity);
}

/**
 * 型が合わないときのログ。コンパイラの言い回しを真似ている。
 *
 * フェーズ5では drop() が DropResult の { reason: "type-error", fn, actual, expected } を
 * 返すので、その値からこの文面を組み立てる形になる。
 */
function typeError(skewer: Skewer, fn: string, expected: string, note: string): void {
  log("error", `${fn}: 型 '${typeName(skewer)}' の引数を型 '${expected}' のパラメーターに割り当てることはできません。`, note);
  sound.buzz();
  game.typeErrors += 1;
}

function returnToOrigin(entity: Entity): void {
  if (entity.zone === "grill" && entity.slot !== null) putOnGrill(entity, entity.slot);
  else putOnBoard(entity);
}

// ---------- ゲームループ ----------

let lastFrame = 0;

function frame(nowMs: number): void {
  const delta = lastFrame === 0 ? 0 : Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;

  if (game.running && delta > 0) {
    advance(delta, nowMs);
  }
  grillCanvas.draw(nowMs, delta);
  requestAnimationFrame(frame);
}

function advance(delta: number, nowMs: number): void {
  // 焼き台の串を進める
  let sizzling = 0;
  for (const entity of entities.values()) {
    if (entity.zone !== "grill" || entity.slot === null) continue;
    if (entity.skewer.status !== "grilling") continue;
    sizzling += 1;
    const before = entity.skewer.status;
    entity.skewer = tick(entity.skewer, heatOfSlot(entity.slot) * 2, delta);
    if (entity.skewer.status !== before) {
      log("info", `tick(skewer, heat, dt) → ${typeName(entity.skewer)}`, "焦げました");
    }
    renderEntity(entity);
  }
  grillCanvas.setSizzling(sizzling);
  sound.setSizzle(sizzling);

  // 注文の出入り
  game.orders = game.orders.filter((order) => {
    const alive = order.placedAt + 60_000 > nowMs;
    if (!alive) {
      game.missed += 1;
      log("info", `// ${KIND_LABEL[order.kind]}のお客さんが帰りました`);
    }
    return alive;
  });
  if (nowMs >= game.nextOrderAt && game.orders.length < MAX_ORDERS) {
    game.orders.push(randomOrder(nowMs));
    game.nextOrderAt = nowMs + 9000 + Math.random() * 5000;
  }
  renderOrders(dom.orders, game.orders, nowMs);

  // 残り時間
  game.timeLeft -= delta;
  if (game.timeLeft <= 0) {
    game.timeLeft = 0;
    finish();
  }
  updateHud();
  if (selectedId) renderTypeView(dom.typeCode, dom.typeActions, entities.get(selectedId)?.skewer);
}

function updateHud(): void {
  const total = Math.max(0, Math.ceil(game.timeLeft));
  dom.time.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  dom.score.textContent = String(game.score);
  dom.time.parentElement?.classList.toggle("hurry", total <= 30);
}

// ---------- 開店・閉店 ----------

function buildBins(): void {
  dom.bins.innerHTML = "";
  for (const kind of KINDS) {
    const bin = document.createElement("div");
    bin.className = "bin";
    bin.dataset["kind"] = kind;
    const sample = buildSkewerEl(createRaw(kind));
    sample.classList.add("sample");
    const label = document.createElement("span");
    label.className = "bin-label";
    label.textContent = KIND_LABEL[kind];
    bin.append(sample, label);
    dom.bins.append(bin);
  }
}

function buildHeatScale(): void {
  dom.heatScale.innerHTML = "";
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const span = document.createElement("span");
    span.textContent = "火";
    span.style.setProperty("--h", String(heatOfSlot(slot)));
    dom.heatScale.append(span);
  }
}

function start(): void {
  for (const entity of entities.values()) entity.el.remove();
  entities.clear();
  select(null);
  dom.log.innerHTML = "";
  dom.orders.innerHTML = "";

  game.running = true;
  game.timeLeft = ROUND_SECONDS;
  game.score = 0;
  game.served = 0;
  game.missed = 0;
  game.typeErrors = 0;
  game.catFed = 0;
  game.orders = [];
  game.nextOrderAt = performance.now() + 1500;

  dom.start.hidden = true;
  dom.end.hidden = true;
  sound.init();
  updateHud();
  log("info", "// 開店しました。左の箱から串をドラッグしてください");
}

function finish(): void {
  game.running = false;
  const stats: readonly (readonly [string, string])[] = [
    ["売上", `${game.score} 円`],
    ["提供した本数", `${game.served} 本`],
    ["帰ったお客さん", `${game.missed} 人`],
    ["型エラー", `${game.typeErrors} 回`],
    ["猫にあげた本数", `${game.catFed} 本`],
  ];
  dom.endStats.innerHTML = stats
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  dom.end.hidden = false;
}

// ---------- 起動 ----------

function main(): void {
  buildBins();
  buildHeatScale();
  grillCanvas.resize();
  select(null);
  drag.start();

  window.addEventListener("resize", () => grillCanvas.resize());
  dom.startBtn.addEventListener("click", start);
  dom.againBtn.addEventListener("click", start);
  dom.mute.addEventListener("click", () => {
    const next = !sound.isMuted();
    sound.setMuted(next);
    dom.mute.textContent = next ? "音 オフ" : "音 オン";
    dom.mute.setAttribute("aria-pressed", String(next));
  });

  requestAnimationFrame(frame);
}

main();
