import { KINDS, SEASONINGS } from "./types";
import type { Order, Kind, Seasoning } from "./types";

const PATIENCE_SECONDS = 60; // 顧客が待てる秒数の定数

/**
 * 注文 id の採番用カウンタ。
 *
 * このファイルで唯一、呼ぶたびに結果が変わる（純粋でない）部分。
 * id は「同じ内容の注文を区別する」ためのものなので、本質的に外から与えるか
 * 採番するしかない。採番の責任を呼び出し側に持たせても純粋にはならないので、
 * ここに閉じ込めてある。
 *
 * テストは createOrder で id を指定できるため、この採番に依存しない。
 */
let nextOrderId = 0;

/**
 * 注文が切れるまでの残り時間（秒）。時間切れ後は 0。
 *
 * now を引数で受け取り、中で Date.now() を呼ばないのは、「残り 3 秒のとき」を
 * remainingSeconds(order, order.placedAt + 57000) のように書いてテストできるため
 *
 * Math.max で 0 止めにしているため「どれだけ過ぎたか」は分からない。
 * 時間切れの判定は remainingSeconds(order, now) === 0 で足りる。
 * 「平均何秒待たせたか」のような集計が要るようになったら、負の値を返す形に変える。
 */
function remainingSeconds(order: Order, now: number): number {
  return Math.max(0, PATIENCE_SECONDS - (now - order.placedAt) / 1000);
}

/**
 * 注文を1件組み立てる。内容を指定して作る版。
 *
 * ランダム生成（randomOrder）と分けてあるのは、テストで狙った注文を作るため。
 * Math.random() が中にあると「ねぎまの塩の注文が来たとき」を試せない。
 * ゲーム本体は randomOrder、テストは createOrder、という使い分けになる。
 */
function createOrder(id: string, kind: Kind, seasoning: Seasoning, placedAt: number): Order {
  return {
    id,
    kind,
    seasoning,
    placedAt,
  };
}

/**
 * 配列からランダムに1つ選ぶ。
 *
 * 引数の `readonly [T, ...T[]]` は「最低1個は入っている配列」を表す型。
 * 普通の `readonly T[]` と違って先頭が必ず存在するので、items[0] の型が
 * T に確定する（undefined が付かない）。空配列を渡すとコンパイルエラーになる。
 *
 * 末尾の `?? items[0]` は、絶対に起きない undefined を埋めるためのもの。
 * noUncheckedIndexedAccess を有効にしているので、items[i] の i が number だと
 * 「範囲外かもしれない」と判断されて T | undefined になる。
 * Math.floor(Math.random() * length) が必ず範囲内なのは人間が知っているだけで、
 * 型には書かれていないため、コンパイラには証明できない。
 *
 * ここを as で黙らせることもできるが、その場合「最低1個ある」という保証まで
 * 一緒に捨てることになるので、型で解ける形にしてある。
 */
function pickRandom<T>(items: readonly [T, ...T[]]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

/**
 * ランダムな注文を1件作る。ゲーム中に客が来るときに使う。
 *
 * KINDS / SEASONINGS を types.ts から値として import している。
 * ここで ["negima", "momo", "kawa"] と書き直すと、Kind に種類を足したときに
 * PROFILES と PRICES はコンパイルエラーになるのに、この一覧だけ古いまま残る。
 * Kind[] 型の3要素配列は Kind が4つになっても型として正しいので、
 * コンパイラは何も言わない。新しい種類の注文が永遠に来ないゲームになる。
 * 値の一覧を1箇所に集めるために KINDS を as const から導出してある。
 */
function randomOrder(placedAt: number): Order {
  const kind = pickRandom(KINDS);
  const seasoning = pickRandom(SEASONINGS);
  nextOrderId += 1;
  return createOrder(`order-${nextOrderId}`, kind, seasoning, placedAt);
}

export { remainingSeconds, createOrder, randomOrder };