import { describe, it, expect } from "vitest";
import {
  placeOnGrill,
  tick,
  flip,
  takeOff,
  season,
  serve,
  isUnseasoned,
  isGrillable,
  isCatSafe,
} from "../src/domain/skewer";
import { createOrder } from "../src/domain/orders";
import type {
  Raw,
  Grilling,
  Undercooked,
  Perfect,
  Seasoned,
  Burnt,
  Kind,
  Seasoning,
} from "../src/domain/types";

function grillingSkewer(kind: Kind, front: number, back: number): Grilling {
  return {
    id: "test-id",
    status: "grilling",
    kind,
    heatSeconds: { front, back },
    facing: "front",
  };
}

// 型ガードは型が守ってくれない場所。中身が述語と合っているかを tsc は検証しないので
// （isGrillable から "raw" を書き落としても何も言われなかった）、テストだけが防具になる。

function rawSkewer(kind: Kind): Raw {
  return { id: "test-id", status: "raw", kind };
}

function undercookedSkewer(kind: Kind): Undercooked {
  return { id: "test-id", status: "undercooked", kind, heatSeconds: { front: 10, back: 10 } };
}

function perfectSkewer(kind: Kind, seasoning: Seasoning | null): Perfect {
  return { id: "test-id", status: "perfect", kind, heatSeconds: { front: 25, back: 25 }, seasoning };
}

function burntSkewer(kind: Kind): Burnt {
  return { id: "test-id", status: "burnt", kind, heatSeconds: { front: 60, back: 60 } };
}

// serve に渡せるのは Seasoned だけ。perfectSkewer の戻り値は Perfect
// （seasoning が Seasoning | null）なのでそのままでは渡せない。
// 戻り値の型を Seasoned にすることで、味付け済みだと確定した串を作る。
function seasonedSkewer(kind: Kind, seasoning: Seasoning): Seasoned {
  return { id: "test-id", status: "perfect", kind, heatSeconds: { front: 25, back: 25 }, seasoning };
}

describe("串の一生", () => {
  it("生のももを両面25秒ずつ焼いて塩をふると、注文どおり120円で提供できる", () => {
    // もも は 25 秒で焼き上がり、50 秒で焦げる（PROFILES）。基本価格は 120 円（PRICES）。
    // 両面ちょうど 25 秒 = 焼けた瞬間なので、焼き加減は満点の 10 点になる。
    const raw: Raw = { id: "test-id", status: "raw", kind: "momo" };
    const order = createOrder(raw.id, "momo", "salt", 0);

    // 焼き台に乗せる。生の串は焼き加減を持たないので 0 から始まる。
    const grilling = placeOnGrill(raw);
    expect(grilling.heatSeconds).toEqual({ front: 0, back: 0 });
    expect(grilling.facing).toBe("front");

    // 表を 25 秒焼く（火力 1 × 25 秒）。
    const frontDone = tick(grilling, 1, 25);
    // tick の戻り値は Grilling | Burnt なので、このままでは flip に渡せない。
    // 「焼き中のはず」を確かめると同時に、型を Grilling に絞り込む。
    if (frontDone.status !== "grilling") {
      throw new Error(`焼き中のはずが ${frontDone.status} になった`);
    }
    expect(frontDone.heatSeconds).toEqual({ front: 25, back: 0 });

    // ひっくり返す。焼き加減は変わらず、火の当たる面だけが入れ替わる。
    const flipped = flip(frontDone);
    expect(flipped.facing).toBe("back");
    expect(flipped.heatSeconds).toEqual({ front: 25, back: 0 });

    // 裏を 25 秒焼く。
    const bothDone = tick(flipped, 1, 25);
    if (bothDone.status !== "grilling") {
      throw new Error(`焼き中のはずが ${bothDone.status} になった`);
    }
    expect(bothDone.heatSeconds).toEqual({ front: 25, back: 25 });

    // 下ろす。両面とも 25 秒以上なので Perfect になる。
    const cooked = takeOff(bothDone);
    expect(cooked.status).toBe("perfect");

    // season は Unseasoned しか受け取らない。Perfect はまだ Unseasoned とは限らない
    // （seasoning が Seasoning | null なので）ので、型ガードで絞り込む。
    if (!isUnseasoned(cooked)) {
      throw new Error("焼き上がり直後なので味付けできる状態のはず");
    }

    // 塩をふる。status は "perfect" のまま、seasoning だけが変わる。
    const seasoned = season(cooked, "salt");
    expect(seasoned.status).toBe("perfect");
    expect(seasoned.seasoning).toBe("salt");

    // 提供する。注文（もも・塩）と一致しているので成功。
    // 売上 = 基本価格 120 × 点数 10 / 10 = 120 円。
    const result = serve(seasoned, order);
    expect(result).toEqual({ ok: true, quality: 10, revenue: 120 });
  });
});

describe("takeOff の境界", () => {
  it("両面25秒ちょうど焼いた串は Perfect になる", () => {
    const grilling = grillingSkewer("momo", 25, 25);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("perfect");
  });

  it("両面24秒焼いた串は Undercooked になる", () => {
    const grilling = grillingSkewer("momo", 24, 24);
    const almostCooked = takeOff(grilling);
    expect(almostCooked.status).toBe("undercooked");
  });

  it("両面49秒焼いた串は Perfect になる", () => {
    const grilling = grillingSkewer("momo", 49, 49);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("perfect");
  });

  it("片面49秒焼いた串は Undercooked になる", () => {
    const grilling = grillingSkewer("momo", 49, 0);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("undercooked");
  });

  it("両面50秒焼いた串は Burnt になる", () => {
    const grilling = grillingSkewer("momo", 50, 50);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("burnt");
  });

  it("片面50秒焼いた串は Burnt になる", () => {
    const grilling = grillingSkewer("momo", 50, 0);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("burnt");
  });

  it("かわを両面20秒焼くと Perfect になる", () => {
    const grilling = grillingSkewer("kawa", 20, 20);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("perfect");
  });

  it("ももを両面20秒焼くと Undercooked になる", () => {
    const grilling = grillingSkewer("momo", 20, 20);
    const cooked = takeOff(grilling);
    expect(cooked.status).toBe("undercooked");
  });
});

describe("placeOnGrill", () => {
  it("生焼けの串を焼き台に戻すと、焼き加減を引き継ぐ", () => {
    const undercooked = undercookedSkewer("momo");
    const grilling = placeOnGrill(undercooked);
    expect(grilling.heatSeconds).toEqual({ front: 10, back: 10 });
  });

  it("生の串を焼き台に乗せると、焼き加減は 0 から始まる", () => {
    const raw = rawSkewer("momo");
    const grilling = placeOnGrill(raw);
    expect(grilling.heatSeconds).toEqual({ front: 0, back: 0 });
  });
});

describe("isGrillable", () => {
  it("生の串は焼き台に乗せられる", () => {
    expect(isGrillable(rawSkewer("momo"))).toBe(true);
  });

  it("生焼けの串は焼き直せる", () => {
    expect(isGrillable(undercookedSkewer("momo"))).toBe(true);
  });

  it("焼き中の串は乗せられない", () => {
    expect(isGrillable(grillingSkewer("momo", 15, 15))).toBe(false);
  });

  it("焼き上がった串は乗せられない", () => {
    expect(isGrillable(perfectSkewer("momo", null))).toBe(false);
  });

  it("焦げた串は乗せられない", () => {
    expect(isGrillable(burntSkewer("momo"))).toBe(false);
  });
});

describe("isCatSafe", () => {
  it("味付けなしは猫に安全", () => {
    expect(isCatSafe(perfectSkewer("momo", null))).toBe(true);
  });

  it("ねぎまは猫に安全でない", () => {
    expect(isCatSafe(perfectSkewer("negima", null))).toBe(false);
  });

  it("味付けありは猫に安全でない", () => {
    expect(isCatSafe(perfectSkewer("momo", "salt"))).toBe(false);
  });

  it("生焼けは猫に安全でない", () => {
    expect(isCatSafe(undercookedSkewer("momo"))).toBe(false);
  });

  it("焦げた串は猫に安全でない", () => {
    expect(isCatSafe(burntSkewer("momo"))).toBe(false);
  });
});

// ts-expect-error が何をするか
// - 次の行が型エラー → @ts-expect-error が吸収して、エラーが消える
// - 次の行がエラーでない → @ts-expect-error 自体がエラーになる
describe("serve", () => {
  it("注文と種類が違うと受け取ってもらえない", () => {
    const order = createOrder("order-1", "momo", "salt", 0);
    const result = serve(seasonedSkewer("negima", "salt"), order);
    expect(result).toEqual({ ok: false, reason: "wrong-kind" });
  });

  it("注文と味付けが違うと受け取ってもらえない", () => {
    const order = createOrder("order-2", "momo", "salt", 0);
    const result = serve(seasonedSkewer("momo", "sauce"), order);
    expect(result).toEqual({ ok: false, reason: "wrong-seasoning" });
  });
});

describe("型による制約", () => {
  it("生の串は serve に渡せない", () => {
    const order = createOrder("order-3", "momo", "salt", 0);
    // @ts-expect-error 生の串は Seasoned ではないので渡せない
    serve(rawSkewer("momo"), order);
  });
});
