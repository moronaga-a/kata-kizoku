import type {
  Grilling,
  Burnt,
  CookProfile,
  Kind,
  Undercooked,
  Perfect,
  Grillable,
  Side,
  Unseasoned,
  Seasoning,
  Seasoned,
  Order,
  ServeResult,
} from "./types";


// =========== 定数　============
/**
 * 串の種類ごとの焼け方。
 *
 * Record<Kind, _> なので、Kind に種類を足すとここの設定漏れがコンパイルエラーになる。
 */
const PROFILES: Record<Kind, CookProfile> = {
  "negima": { perfectFromSeconds: 30, burntFromSeconds: 60 },
  "momo": { perfectFromSeconds: 25, burntFromSeconds: 50 },
  "kawa": { perfectFromSeconds: 20, burntFromSeconds: 40 },
};

/**
 * 串の種類ごとの価格
 */
const PRICES: Record<Kind, number> = {
  "negima": 100,
  "momo": 120,
  "kawa": 80,
};

// =========== ヘルパー　============
/**
 * 焦げているかどうか。
 *
 * || なのは、片面でも焦げたら串全体が焦げ扱いのため。
 */
function isBurnt(heatSeconds: Readonly<Record<Side, number>>, profile: CookProfile): boolean {
  return heatSeconds.front >= profile.burntFromSeconds || heatSeconds.back >= profile.burntFromSeconds;
}

/**
 * 片面ぶんの焼き加減を 10 点満点で採点する。
 *
 * 満点は perfectFromSeconds ちょうどの焼けた瞬間。
 * そこから burntFromSeconds に近づくほど下がり、焦げる直前で 0 点になる。
 *
 * 0〜1 にクランプしているのは、Perfect 型が「両面とも完璧ラインを超えている」ことを保証していないため。
 * 保証しているのは takeOff() であって型ではないので、手で組み立てた Perfect（テストなど）が範囲外の秒数を持ちうる。
 * クランプしないと 10 点を超えたり、マイナスになったりする。
 */
function scoreFor(seconds: number, profile: CookProfile): number {
  const span = profile.burntFromSeconds - profile.perfectFromSeconds;
  const progress = Math.min(Math.max((seconds - profile.perfectFromSeconds) / span, 0), 1);
  return (1 - progress) * 10;
}

// =========== 遷移関数　============
/**
 * 焼き台に乗せる。
 *   - 生の串をこれから焼く（Raw）
 *   - 生焼けの串を焼き直す（Undercooked）
 *
 * Grillable = Raw | Undercooked なので、焦げた串も焼き上がった串も渡せない。（焦げたらもう戻せない）
 *
 * facing を引数で受け取らず "front" 固定にしているのは、
 * 今のゲームでは置くときに面を選べないためで、選ばせたくなったら引数を足す。
 */
function placeOnGrill(skewer: Grillable): Grilling {
  // union を受け取った時点では、全メンバーが共通して持つフィールドしか触れない。
  // Grillable = Raw | Undercooked のうち Raw は heatSeconds を持たないので、
  // skewer.heatSeconds と書くとコンパイルエラーになる（実行時に undefined になりうるため）。
  //
  // status で比較すると、その枝の中では型が絞り込まれて heatSeconds が見えるようになる。
  // これが効くのは status がリテラル型（"raw" / "undercooked"）だから。
  // status: string にしていたら、比較しても型は絞り込まれない。
  if (skewer.status === "raw") {
    // 生の串は焼き加減を持たない。ここで 0 から作る。
    return { status: "grilling", kind: skewer.kind, facing: "front", heatSeconds: { front: 0, back: 0 } };
  } else {
    // 焼き直しなので、前回までの焼き加減を引き継ぐ。
    // Undercooked に heatSeconds を持たせておいたのはこのため。
    return { status: "grilling", kind: skewer.kind, facing: "front", heatSeconds: skewer.heatSeconds };
  }
}

/**
 * 火力 × 経過秒を、今火に当たっている面にだけ足す。
 *
 * 戻り値が Grilling | Burnt なのは、焦げた時点で Grilling から出る設計のため。
 * 「焦げながら焼き中」という状態は存在しない。
 */
function tick(skewer: Grilling, firePower: number, elapsedSeconds: number): Grilling | Burnt {
  // 計算プロパティ [skewer.facing] で、今焼けている面だけを上書きする。
  // heatSeconds を Record<Side, number> にしたので front / back の分岐が要らない。
  //
  // facing は "front" | "back" のどちらか実行時まで決まらないが、スプレッドで両方のキーを先に入れているので中身は必ず揃う。
  // コンパイラがそこまで読んでくれるか tsc で確認して問題ないことを確認。通らなければ heatSeconds を front/back の2フィールドに分ける予定だった。
  const next = {
    ...skewer.heatSeconds,
    [skewer.facing]: skewer.heatSeconds[skewer.facing] + firePower * elapsedSeconds,
  };
  const updatedSkewer = { ...skewer, heatSeconds: next };

  // PROFILES が Record<Kind, _> なので kind で引けば必ず見つかる。
  // Record<string, _> だと noUncheckedIndexedAccess が効いて CookProfile | undefined になり、
  // 毎回 undefined チェックを書く必要があった。
  const profile = PROFILES[skewer.kind];

  if (isBurnt(updatedSkewer.heatSeconds, profile)) {
    // 状態が変わる = フラグを立てるのではなく、その状態の形に作り直す。
    // facing を引き継がないのは、焦げた串に「今どっちが下か」が意味を持たないから。
    return { status: "burnt", kind: skewer.kind, heatSeconds: updatedSkewer.heatSeconds };
  }

  return updatedSkewer;
}

/**
 * 今火に当たってる面を入れ替える
 */
function flip(skewer: Grilling): Grilling {
  return {
    ...skewer,
    facing: skewer.facing === "front" ? "back" : "front",
  };
}

/**
 * 焼き台から下ろす。焼き加減を判定して、3つの状態のどれかに振り分ける。
 *
 * この関数が「量 → ラベル」の変換を担当している。
 * Grilling に heatSeconds という量だけを持たせ、生焼け・完璧・焦げのラベルを
 * 持たせなかったのは、この判定をここに一箇所だけ置くため。
 * もし Grilling がラベルを直接持っていたら、この関数はそれを読み替えるだけの関数になってしまう。
 *
 * 戻り値が3つの union なのは、下ろした後にできることが3つとも違うから
 * （生焼けは焼き直せる、完璧は味付けできる、焦げは捨てるだけ）。
 */
function takeOff(skewer: Grilling): Undercooked | Perfect | Burnt {
  const profile = PROFILES[skewer.kind];
  const front = skewer.heatSeconds.front;
  const back = skewer.heatSeconds.back;

  // 判定の順番が重要。焦げを先に見ないと、「表は完璧・裏は焦げ」の串がPerfect に化けてしまう。
  if (isBurnt(skewer.heatSeconds, profile)) {
    return { status: "burnt", kind: skewer.kind, heatSeconds: skewer.heatSeconds };
  }

  // 表裏両面とも焼けていないと完璧にはならない。
  // 片面だけ焼いて下ろすと、ここを通らず Undercooked に落ちる。
  if (front >= profile.perfectFromSeconds && back >= profile.perfectFromSeconds) {
    // seasoning: null は「まだ味付けしていない」。焼き上がった直後なので当然 null になる。
    // Perfect.seasoning を Seasoning だけにしていたら、この関数が塩かタレを勝手に決めなければならないので | null を入れた
    return { status: "perfect", kind: skewer.kind, heatSeconds: skewer.heatSeconds, seasoning: null };
  }

  // どちらにも当てはまらない = まだ焼けていない。焼き台に戻せる（Grillable に入っている）。
  return { status: "undercooked", kind: skewer.kind, heatSeconds: skewer.heatSeconds };
}

/**
 * 焼き上がった串に味付けする。
 *
 * 引数と戻り値だけで仕様を語っている関数。実行時のチェックが一つもない。
 *   - 生焼けも焦げも渡せない（Unseasoned は Perfect 由来なので）
 *   - 二度塗りもできない（Seasoned な串は Unseasoned ではないので渡せない）
 *
 * Seasoned は新しい状態ではなくPerfect の切り出し（Perfect & { seasoning: Seasoning }）だから、
 * status は "perfect" のまま変わらない。
 * tick の Burnt が「別の状態へ移る」ので形ごと作り直したのに対して、
 * こちらは「同じ状態の中で seasoning の値が null から変わる」だけなのでスプレッドで済む。
 */
function season(skewer: Unseasoned, seasoning: Seasoning): Seasoned {
  return { ...skewer, seasoning };
}

/**
 * 注文と照合して、お客さんに出す。
 *
 * 実行時に確かめているのは「種類が違う」「味付けが違う」の2つだけ。
 * 引数が Seasoned なので、生焼け・焦げ・味付けなしの串はそもそもここに来られない。
 * それらを弾くのは drop() の仕事で、通ったものだけがこの関数に渡る。
 * 型で防げている範囲は、実行時に防ぎ直さなくてよい。
 *
 * 売上は 基本価格 × 点数 / 10。焼き加減が売上に直結するようにした
 * Math.floor で整数にしているのは、売上を足し上げて閉店画面に出すため。
 * 小数のままだと集計に端数が溜まる（点数のほうは丸めず UI に任せている）。
 */
function serve(skewer: Seasoned, order: Order): ServeResult {
  if (skewer.kind !== order.kind) {
    return { ok: false, reason: "wrong-kind" };
  }
  if (skewer.seasoning !== order.seasoning) {
    return { ok: false, reason: "wrong-seasoning" };
  }

  const score = quality(skewer);

  return { ok: true, quality: score, revenue: Math.floor(PRICES[skewer.kind] * score / 10) };
}

// =========== 集計　============
/**
 * 串の焼き加減を 10 点満点で採点する。両面の平均。
 *
 * 平均なので「表 10 点・裏 0 点」は 5 点になる。
 * 低いほうを採る案もあるが今は平均にしている。
 *
 * 丸めはしていない。小数のまま返して、表示のときに丸めるのは UI 側の仕事とする。
 */
function quality(skewer: Perfect): number {
  const profile = PROFILES[skewer.kind];
  const frontScore = scoreFor(skewer.heatSeconds.front, profile);
  const backScore = scoreFor(skewer.heatSeconds.back, profile);

  return (frontScore + backScore) / 2;
}


export { flip, isBurnt, tick, takeOff, placeOnGrill, season, quality, serve };