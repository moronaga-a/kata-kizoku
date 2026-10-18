import { createRaw, tick, flip, typeName, catRefusal, assertNever } from "./domain/skewer";
import { randomOrder } from "./domain/orders";
import { drop } from "./game/drop";
import { KINDS } from "./domain/types";
import type { DropResult, DropTarget, Order, Skewer } from "./domain/types";

import { Sound } from "./ui/audio";
import { Cat } from "./ui/cat";
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
const cat = new Cat($("#cat"), $("#cat-bubble"));
const grillCanvas = new GrillCanvas($canvas("#coals"), $canvas("#smoke"));

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
 * ドロップされたときの処理。判断は src/game/drop.ts の drop() が全部やる。
 *
 * ここがやるのは「結果を受け取って画面と音を変える」だけ。
 * どの串がどこに行けるかというルールは一切持たない。
 * result.effect で switch しているので、effect を増やすと
 * ここの書き漏れがコンパイルエラーになる。
 */
function handleDrop(id: string, to: DropTarget, fromBin: boolean): void {
  const entity = entities.get(id);
  if (!entity) return;

  const result = drop(entity.skewer, to, game.orders);

  if (!result.ok) {
    showFailure(result, entity);
    settle(entity, fromBin);
    return;
  }

  switch (result.effect) {
    case "none":
      settle(entity, fromBin);
      return;

    case "placed": {
      const before = typeName(entity.skewer);
      entity.skewer = result.skewer;
      // 焼き台のどの枠かは drop() ではなく DropTarget が持っている
      const slot = to.target === "grill" ? to.slot : (entity.slot ?? 0);
      if (before !== "Grilling") log("ok", `placeOnGrill(skewer: ${before}) → Grilling`);
      putOnGrill(entity, slot);
      select(entity.skewer.id);
      return;
    }

    case "takenOff":
      entity.skewer = result.skewer;
      log(
        result.skewer.status === "perfect" ? "ok" : "info",
        `takeOff(skewer) → ${typeName(result.skewer)}`,
        result.skewer.status === "perfect" ? "いい焼き加減" : result.skewer.status === "burnt" ? "焼きすぎ" : "まだ生焼け",
      );
      putOnBoard(entity);
      select(entity.skewer.id);
      return;

    case "seasoned":
      entity.skewer = result.skewer;
      log("ok", `season(skewer, "${result.skewer.seasoning}") → Seasoned`);
      sound.flip();
      putOnBoard(entity);
      select(entity.skewer.id);
      return;

    case "served": {
      game.score += result.revenue;
      game.served += 1;
      // 満たされた伝票を下げる
      if (to.target === "order") {
        game.orders = game.orders.filter((o) => o.id !== to.orderId);
      }
      log("ok", `serve(skewer, order) → +${result.revenue}円`, `焼き加減 ${result.quality.toFixed(1)} 点`);
      sound.chime();
      removeEntity(entity);
      return;
    }

    case "fedCat":
      game.catFed += 1;
      log("ok", "feedCat(skewer: CatSafe)", "にゃー。招き猫効果でお客さんが来ます");
      cat.accept();
      sound.chime();
      removeEntity(entity);
      // 招き猫効果。次の注文を前倒しする
      game.nextOrderAt = Math.min(game.nextOrderAt, performance.now() + 300);
      return;

    case "discarded":
      // ゴミ箱だけが Skewer（全状態）を受け取る。他のドロップ先は型で絞られているので、
      // 焦げた串の行き先がここしかないのは「Burnt を受け取る関数が他にない」ということ。
      // 焦げたときだけその説明を出す。毎回出すとうるさいので。
      log(
        "info",
        `discard(skewer: ${typeName(entity.skewer)})`,
        entity.skewer.status === "burnt"
          ? "Burnt を受け取るのは Skewer を取る discard だけ"
          : "お残しは許しまへんで〜",
      );
      removeEntity(entity);
      return;

    default:
      return assertNever(result);
  }
}

/** 失敗の見せ方。型エラーと注文違いで文面も演出も変える */
function showFailure(result: Extract<DropResult, { ok: false }>, entity: Entity): void {
  sound.buzz();
  if (result.reason === "type-error") {
    // コンパイラの言い回しをそのまま真似る。
    // 本来ならコンパイルエラーになる操作を、ゲーム内で再現している。
    log(
      "error",
      `${result.fn}: 型 '${result.actual}' の引数を型 '${result.expected}' のパラメーターに割り当てることはできません。`,
    );
    game.typeErrors += 1;
    if (result.fn === "feedCat") {
      // 猫のセリフは DropResult には乗っていないので、ここで改めて理由を聞く。
      // catRefusal は "negima" を最優先し、焼き加減はまとめて "not-ready" にするので、
      // 下ろす前の串で聞いても答えは変わらない。
      cat.refuse(catRefusal(entity.skewer) ?? "not-ready");
    }
    return;
  }
  // 注文違い。型では判定できず、実行時に確かめるしかなかったほう
  log("error", `ServeResult { ok: false, reason: "${result.mismatch}" }`, "注文と違います");
}

/** ドロップが実らなかったときの後始末。箱から出したばかりの串はまな板に置く */
function settle(entity: Entity, fromBin: boolean): void {
  if (fromBin) putOnBoard(entity);
  else returnToOrigin(entity);
}

function removeEntity(entity: Entity): void {
  entity.el.remove();
  entities.delete(entity.skewer.id);
  if (selectedId === entity.skewer.id) select(null);
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
