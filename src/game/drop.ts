import type { Skewer, DropTarget, DropResult, Order, Raw, Undercooked, Perfect, Burnt } from "../domain/types";
import {
  takeOff,
  assertNever,
  isUnseasoned,
  season,
  typeName,
  isCatSafe,
  placeOnGrill,
  isGrillable,
  isSeasoned,
  serve,
} from "../domain/skewer";

function drop(skewer: Skewer, to: DropTarget, orders: readonly Order[]): DropResult {
  // 焼き台は唯一「下ろさずに扱う」ドロップ先なので、switch の前に片付ける。そうすると、この後は「焼き台から下ろした串」だけを相手にすればよくなる。
  if (to.target === "grill") {
    if (skewer.status === "grilling") return { ok: true, effect: "placed", skewer }; // 枠を移すだけ
    if (!isGrillable(skewer)) return { ok: false, reason: "type-error", fn: "placeOnGrill", actual: typeName(skewer), expected: "Grillable" };
    return { ok: true, effect: "placed", skewer: placeOnGrill(skewer) };
  }

  // 焼き台以外のどこに落とす場合でも、まず焼き台から下ろす。
  // 焼いている串をタレ壺に落としたとき、毎回まな板を経由させるのは面倒なので、ここでまとめて下ろしてしまう。
  //
  // liftOffGrill の戻り値には Grilling が入っていないので、以降の case では「焼き中かもしれない」を考えなくてよくなる。
  const lifted = liftOffGrill(skewer);

  switch (to.target) {
    case "none":
      return { ok: true, effect: "none" };
    case "board":
      if (lifted.status === "raw") {
        return { ok: false, reason: "type-error", fn: "takeOff", actual: typeName(lifted), expected: "Grilling" };
      }
      return { ok: true, effect: "takenOff", skewer: lifted };
    case "trash":
      return { ok: true, effect: "discarded" };
    case "season":
      if (!isUnseasoned(lifted)) {
        return { ok: false, reason: "type-error", fn: "season", actual: typeName(lifted), expected: "Unseasoned" };
      }
      return { ok: true, effect: "seasoned", skewer: season(lifted, to.seasoning) };
    case "cat":
      if (!isCatSafe(lifted)) {
        return { ok: false, reason: "type-error", fn: "feedCat", actual: typeName(lifted), expected: "CatSafe" };
      }
      return { ok: true, effect: "fedCat" };
    case "order": {
      const order = orders.find(o => o.id === to.orderId);
      if (!order) {
        return { ok: true, effect: "none" };
      }
      if (!isSeasoned(lifted)) {
        return { ok: false, reason: "type-error", fn: "serve", actual: typeName(lifted), expected: "Seasoned" };
      }
      const result = serve(lifted, order);
      if (!result.ok) {
        return { ok: false, reason: "wrong-order", mismatch: result.reason };
      }
      return { ok: true, effect: "served", revenue: result.revenue, quality: result.quality };
    }
    default:
      return assertNever(to);
  }
}

/** 焼き台の上なら下ろす。そうでなければそのまま */
function liftOffGrill(skewer: Skewer): Raw | Undercooked | Perfect | Burnt {
  return skewer.status === "grilling" ? takeOff(skewer) : skewer;
}

export { drop };