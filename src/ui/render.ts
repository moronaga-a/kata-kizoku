import { PROFILES } from "../domain/skewer";
import { typeName, availableActions } from "../domain/skewer";
import { remainingSeconds } from "../domain/orders";
import type { Kind, Seasoning, Skewer, Order, Action } from "../domain/types";

/**
 * 画面の文言。ドメインはコード（"momo" / "salt" / "negima"）だけを持ち、
 * 日本語はすべてここに置く。文言を変えるために src/domain/ を触らなくて済むようにするため。
 *
 * Record<Kind, string> なので、串の種類を増やすとここの書き忘れが
 * コンパイルエラーになる。PROFILES / PRICES と同じ仕掛け。
 */
const KIND_LABEL: Record<Kind, string> = {
  negima: "ねぎま",
  momo: "もも",
  kawa: "かわ",
};

const SEASONING_LABEL: Record<Seasoning, string> = {
  salt: "塩",
  sauce: "タレ",
};

/** availableActions() が返すコードを、呼び出し式の形で見せる */
const ACTION_SIGNATURE: Record<Action, string> = {
  placeOnGrill: "placeOnGrill(skewer)",
  flip: "flip(skewer)",
  takeOff: "takeOff(skewer)",
  season: 'season(skewer, "salt" | "sauce")',
  serve: "serve(skewer, order)",
  feedCat: "feedCat(skewer)",
  discard: "discard(skewer)",
};

/** 串 1 本を構成するネタの並び。見た目だけの情報なのでドメインには持たせない */
type PieceType = "meat" | "negi" | "kawa";
const PIECES: Record<Kind, readonly PieceType[]> = {
  momo: ["meat", "meat", "meat", "meat"],
  negima: ["meat", "negi", "meat", "negi", "meat"],
  kawa: ["kawa", "kawa", "kawa", "kawa", "kawa"],
};

type Rgb = readonly [number, number, number];
/** 焼け具合（0〜1）と、そのときの色 */
type Stop = readonly [number, Rgb];

/** 焼き色。焼けた秒数の割合（0〜1）から色を引く */
function ramp(stops: readonly (readonly [number, string])[]): (t: number) => string {
  // 戻り値に Stop[] と型を付けておくと、中の配列リテラルがタプルとして推論される。
  // 付けないと (number | Rgb)[] に広がるので as const で狭め直すことになる。
  const parsed: Stop[] = stops.map(([at, color]) => [at, hexToRgb(color)]);
  return (t) => {
    const first = parsed[0];
    const last = parsed[parsed.length - 1];
    if (!first || !last) return "#000";
    if (t <= first[0]) return rgb(first[1]);
    for (let i = 1; i < parsed.length; i++) {
      const a = parsed[i - 1];
      const b = parsed[i];
      if (!a || !b) continue;
      if (t <= b[0]) {
        const k = (t - a[0]) / (b[0] - a[0]);
        return rgb([
          Math.round(a[1][0] + (b[1][0] - a[1][0]) * k),
          Math.round(a[1][1] + (b[1][1] - a[1][1]) * k),
          Math.round(a[1][2] + (b[1][2] - a[1][2]) * k),
        ]);
      }
    }
    return rgb(last[1]);
  };
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** 焼け具合 0〜1 に対する色。1 が焦げ */
const COLOR: Record<PieceType, (t: number) => string> = {
  meat: ramp([[0, "#eea394"], [0.3, "#ecc3a2"], [0.6, "#cf924f"], [0.84, "#98582b"], [1, "#3b2720"]]),
  kawa: ramp([[0, "#f3ddc5"], [0.3, "#f0d098"], [0.6, "#dca25a"], [0.84, "#a8672c"], [1, "#3d2920"]]),
  // ねぎは緑を強めに、しかも焼いても後半まで緑が残るようにしてある。
  // 肉と同じカーブだと焼けた途中で見分けがつかなくなるため。
  negi: ramp([[0, "#7fb63f"], [0.45, "#93b94d"], [0.72, "#b09a44"], [0.88, "#6e5230"], [1, "#35271f"]]),
};

/** 串の DOM を組み立てる。中身の更新は renderSkewer が受け持つ */
function buildSkewerEl(skewer: Skewer): HTMLElement {
  const el = document.createElement("div");
  el.className = `skewer kind-${skewer.kind}`;
  el.dataset["id"] = skewer.id;
  el.setAttribute("role", "img");

  const stick = document.createElement("div");
  stick.className = "stick";

  const pieces = document.createElement("div");
  pieces.className = "pieces";
  for (const type of PIECES[skewer.kind]) {
    const piece = document.createElement("div");
    piece.className = `piece piece-${type}`;
    piece.dataset["type"] = type;
    pieces.append(piece);
  }

  // ゲージ。緑の帯が「ちょうどいい焼き加減」の範囲。
  // 満タン = 焦げる秒数。帯の下端が perfectFromSeconds。
  const profile = PROFILES[skewer.kind];
  const gauge = document.createElement("div");
  gauge.className = "gauge";
  gauge.innerHTML = `<i class="g-front"></i><i class="g-back"></i>`;
  gauge.style.setProperty("--pmin", String(profile.perfectFromSeconds / profile.burntFromSeconds));
  gauge.style.setProperty("--pmax", "1");

  el.append(stick, pieces, gauge);
  return el;
}

/**
 * 見た目の焼き色に使う値。焼いている最中は「上を向いている面」が見えるので、
 * 下の面（今焼けている側）の色はあまり出さない。
 */
function visibleDoneness(skewer: Skewer): number {
  if (skewer.status === "raw") return 0;
  const profile = PROFILES[skewer.kind];
  const { front, back } = skewer.heatSeconds;
  const seconds =
    skewer.status === "grilling"
      ? skewer.facing === "front"
        ? back * 0.65 + front * 0.35
        : front * 0.65 + back * 0.35
      : Math.max(front, back);
  return Math.min(1, seconds / profile.burntFromSeconds);
}

/** 串の見た目を今の状態に合わせる */
function renderSkewer(el: HTMLElement, skewer: Skewer, selected: boolean): void {
  const doneness = visibleDoneness(skewer);
  const profile = PROFILES[skewer.kind];

  el.dataset["status"] = skewer.status;
  el.classList.toggle("selected", selected);
  el.classList.toggle("sauce", skewer.status === "perfect" && skewer.seasoning === "sauce");
  el.classList.toggle("salt", skewer.status === "perfect" && skewer.seasoning === "salt");
  el.setAttribute("aria-label", `${KIND_LABEL[skewer.kind]}（${typeName(skewer)}）`);

  // dataset から読むと string が返るので PieceType に戻すのに as が要る。
  // 代わりに PIECES の並びと DOM の並びを突き合わせる。
  // buildSkewerEl が同じ配列から要素を作っているので順番は必ず一致する。
  const types = PIECES[skewer.kind];
  const pieceEls = el.querySelectorAll<HTMLElement>(".piece");
  types.forEach((type, i) => {
    const pieceEl = pieceEls[i];
    // background ではなく backgroundColor を指定する。
    // 一括指定だと CSS 側の background-image（かわのシワ）を消してしまうため。
    if (pieceEl) pieceEl.style.backgroundColor = COLOR[type](doneness);
  });
  // 焼き目（縞模様）は半分くらい焼けてから出す
  el.style.setProperty("--mark", String(clamp01((doneness - 0.35) / 0.45)));

  if (skewer.status !== "raw") {
    el.style.setProperty("--front", String(clamp01(skewer.heatSeconds.front / profile.burntFromSeconds)));
    el.style.setProperty("--back", String(clamp01(skewer.heatSeconds.back / profile.burntFromSeconds)));
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 注文伝票。DOM を作り直さず、あるものは使い回す */
function renderOrders(container: HTMLElement, orders: readonly Order[], now: number): void {
  const existing = new Map<string, HTMLElement>();
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(".ticket"))) {
    const id = el.dataset["orderId"];
    if (id) existing.set(id, el);
  }

  for (const order of orders) {
    let el = existing.get(order.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "ticket";
      el.dataset["zone"] = "order";
      el.dataset["orderId"] = order.id;
      el.innerHTML = `
        <span class="ticket-kind">${KIND_LABEL[order.kind]}</span>
        <span class="ticket-season season-${order.seasoning}">${SEASONING_LABEL[order.seasoning]}</span>
        <span class="ticket-code">serve(Seasoned &amp; { kind: "${order.kind}", seasoning: "${order.seasoning}" })</span>
        <span class="patience"><i></i></span>`;
      container.append(el);
    }
    existing.delete(order.id);

    const left = remainingSeconds(order, now) / 60;
    el.style.setProperty("--left", String(left));
    el.classList.toggle("hurry", left < 0.3);
  }

  for (const el of existing.values()) el.remove();
  container.classList.toggle("empty", orders.length === 0);
}

/**
 * 型ビュー。選んだ串の状態を TypeScript のコードとして表示する。
 *
 * typeName() が返す型名と availableActions() が返す操作をそのまま出しているので、
 * ドメインの型設計が画面にそのまま現れる。発表で見せたい部分。
 */
function renderTypeView(codeEl: HTMLElement, actionsEl: HTMLElement, skewer: Skewer | undefined): void {
  if (!skewer) {
    codeEl.innerHTML = `<span class="t-comment">// 串をクリックすると\n// いまの状態が型で表示されます</span>`;
    actionsEl.innerHTML = `<li class="muted">—</li>`;
    return;
  }

  const lines = [
    `<span class="t-kw">const</span> skewer: <span class="t-type">${typeName(skewer)}</span> = {`,
    field("id", skewer.id),
    field("status", skewer.status),
    field("kind", skewer.kind),
  ];
  if (skewer.status === "grilling") lines.push(field("facing", skewer.facing));
  if (skewer.status !== "raw") {
    lines.push(
      `  <span class="t-prop">heatSeconds</span>: { front: <span class="t-num">${Math.round(skewer.heatSeconds.front)}</span>, back: <span class="t-num">${Math.round(skewer.heatSeconds.back)}</span> },`,
    );
  }
  if (skewer.status === "perfect") lines.push(field("seasoning", skewer.seasoning));
  lines.push("};");

  codeEl.innerHTML = lines.join("\n");
  actionsEl.innerHTML = availableActions(skewer)
    .map((a) => `<li><code>${escapeHtml(ACTION_SIGNATURE[a])}</code></li>`)
    .join("");
}

function field(name: string, value: string | number | null): string {
  let shown: string;
  if (value === null) shown = `<span class="t-kw">null</span>`;
  else if (typeof value === "number") shown = `<span class="t-num">${Math.round(value)}</span>`;
  else shown = `<span class="t-str">"${escapeHtml(value)}"</span>`;
  return `  <span class="t-prop">${name}</span>: ${shown},`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}

export {
  KIND_LABEL,
  SEASONING_LABEL,
  buildSkewerEl,
  renderSkewer,
  renderOrders,
  renderTypeView,
  escapeHtml,
};
