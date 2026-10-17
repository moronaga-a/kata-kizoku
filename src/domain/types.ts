const KINDS = ["negima", "momo", "kawa"] as const;
type Kind = typeof KINDS[number];
const SEASONINGS = ["salt", "sauce"] as const;
type Seasoning = typeof SEASONINGS[number];

// 値の export。KINDS / SEASONINGS は実行時にも存在する配列なので type を付けない
export { KINDS, SEASONINGS };
// 型の export。コンパイル後には消えるもの
export type {
  Kind,
  Seasoning,
  Side,
  Raw,
  Grilling,
  Undercooked,
  Perfect,
  Burnt,
  Skewer,
  Unseasoned,
  Seasoned,
  CatSafe,
  Grillable,
  CookProfile,
  Order,
  ServeResult,
  CatRefusalReason,
  Action,
  DropTarget,
  DropResult,
};

/**
 * 串の面。
 *
 * Kind と違って as const の配列から導出していないのは、串の表裏は増えないから。
 */
type Side = "front" | "back";

/**
 * availableActions() が返すもの＝その状態でできることの一覧
 *
 * UI のボタンの出し分けに使う
 * フェーズ 5 の DropTarget（ドロップ先）と対応する
 *
 * "discard" だけ少し性格が違い、skewer.ts の遷移関数と対応する関数がない
 */
type Action = "placeOnGrill" | "flip" | "takeOff" | "season" | "serve" | "feedCat" | "discard";

/**
 * 串をどこに落としたか。drop(skewer, to) の第2引数。
 *
 * Action（その状態でできること）とほぼ 1 対 1 で対応する。
 * Action が「この串に何ができるか」、DropTarget が「どこに落とせばそれが起きるか」。
 *
 *   grill  ↔ placeOnGrill    board ↔ takeOff    season ↔ season
 *   order  ↔ serve           cat   ↔ feedCat    trash  ↔ discard
 *
 * flip だけ対応するドロップ先がない。ひっくり返すのはドラッグではなく
 * 焼き台の串をクリックする操作なので、落とす先が存在しない。
 *
 * "none"（どこでもない場所に落とした）も union のメンバーにしてある。
 * DropTarget | null にすると drop() の switch から漏れるが、メンバーにしておけば
 * case "none" として書けて assertNever の網羅チェックに乗る。
 * ドロップ先を増やしたときの書き漏れがコンパイルエラーになる。
 *
 * slot（焼き台の何番目の枠か）を Skewer ではなくここが持っているのは、
 * 串が自分の居場所を知らない設計にしているため。位置は UI とゲーム進行の関心事で、焼き鳥そのものの性質ではない。
 */
type DropTarget =
  | { readonly target: "grill"; readonly slot: number }
  | { readonly target: "board" }
  | { readonly target: "season"; readonly seasoning: Seasoning }
  | { readonly target: "trash" }
  | { readonly target: "cat" }
  | { readonly target: "order"; readonly orderId: string }
  | { readonly target: "none" };

/**
 * 串をドロップした結果。drop() が返す。UI はこれを見て画面と音を変える。
 *
 * 失敗が2種類あるのがこの型の肝。
 *   type-error   そもそも渡せない串だった（焦げた串を伝票に落とした、など）。
 *                本来ならコンパイルエラーになる操作を、ゲーム内で再現している。
 *   wrong-order  渡せたが注文と中身が違った。型では判定できず、実行時に確かめるしかない。
 * 「型で守れる範囲と守れない範囲」の境界が、そのまま UI のメッセージの出し分けになる。
 *
 * 成功側は effect ごとに持つものが違う。串が残るもの（placed / takenOff / seasoned）は
 * 絞った型で返すので、UI は "placed" の枝で facing があると分かる。
 * 串が消えるもの（served / fedCat / discarded）は串を返さない。
 */
type DropResult =
  // --- 成功 ---
  | { readonly ok: true; readonly effect: "placed"; readonly skewer: Grilling }
  | { readonly ok: true; readonly effect: "takenOff"; readonly skewer: Undercooked | Perfect | Burnt }
  | { readonly ok: true; readonly effect: "seasoned"; readonly skewer: Seasoned }
  | { readonly ok: true; readonly effect: "served"; readonly revenue: number; readonly quality: number }
  | { readonly ok: true; readonly effect: "fedCat" }
  | { readonly ok: true; readonly effect: "discarded" }
  | { readonly ok: true; readonly effect: "none" } // 何もない場所で離した。失敗ではなく、串は元の場所に戻るだけ。
  // --- 失敗 ---
  // コンパイラ風のメッセージを組み立てる材料を返す。文面そのものは UI が作る。
  // 「<fn>: 型 '<actual>' の引数を型 '<expected>' のパラメーターに割り当てることはできません」
  | {
      readonly ok: false;
      readonly reason: "type-error";
      readonly fn: Action;
      readonly actual: string;
      readonly expected: string;
    }
  | { readonly ok: false; readonly reason: "wrong-order"; readonly mismatch: "wrong-kind" | "wrong-seasoning" };

/**
 * 猫にあげられない理由。catRefusal() が返す。あげてよい場合は null なのでここには含めない。
 *
 * セリフそのものではなく理由のコードなので、日本語の文面や演出は UI 側で持つ。
 * 文言を変えるために domain を触らなくて済むようにするため。
 *
 *   negima    ネギ類は猫に毒（溶血性貧血を起こす）。この型設計の出発点になった現実のルール
 *   seasoned  塩分が猫に良くない
 *   not-ready 焼けていない・焦げているなど、そもそも食べ物として出せない
 */
type CatRefusalReason = "negima" | "seasoned" | "not-ready";

/**
 * 生の串。まだ焼き台に乗っていない。
 * 焼き加減のフィールドを持たないことで「まだ火が入っていない」ことを型で保証する。
 */
type Raw = {
  /** 全状態が共通で持つフィールド */
  readonly id: string;
  readonly status: "raw";
  /** 串の種類。生から焦げまで一度も変わらないので readonly */
  readonly kind: Kind;
};

/**
 * 焼き台の上にある串。
 *
 * 面ごとに「火に当たった累計秒数」という量だけを持ち、
 * 焼き加減のラベル（生焼け・完璧・焦げ）は持たず何秒分焼けたかをみて判断する
 *   焼き加減ラベルだと何秒焼いても値が変わらず、いつ "perfect" になるのか決まらない。
 *   Grilling の中に "burnt" が書けてしまうと、焦げた状態で焼き続けることが型的に許されてしまう。
 * ラベルは takeOff() が heatSeconds と CookProfile から判定して決める。
 */
type Grilling = {
  readonly id: string;
  readonly status: "grilling";
  readonly kind: Kind;
  /** 今どちらの面が火に当たっているか。 */
  readonly facing: Side;
  /**
   * 面ごとの、火に当たった累計秒数。
   *
   * Readonly<> で包んでいるのは readonly が 1 階層しか効かないため。
   * これがないと s.heatSeconds.front = 999 が通ってしまい、
   * 「遷移関数は純粋関数にする」という方針が型で守れない。
   */
  readonly heatSeconds: Readonly<Record<Side, number>>;
};

/**
 * 調理台の上にある串。生焼けだけが Grillable に入って焼き直せる
 */
type Undercooked = {
  readonly id: string;
  readonly status: "undercooked";
  readonly kind: Kind;
  /** 焼き加減をGrillingから引き継ぐ */
  readonly heatSeconds: Readonly<Record<Side, number>>;
};

/**
 * 焼き上がり、味付けをする串
 */
type Perfect = {
  readonly id: string;
  readonly status: "perfect";
  readonly kind: Kind;
  /** 焼き加減をGrillingから引き継ぐ */
  readonly heatSeconds: Readonly<Record<Side, number>>;
  /** 味付けの種類。焼いた直後は味付けしていないので初期値は null になる */
  readonly seasoning: Seasoning | null;
};

/**
 * 焦げた串。もう焼き直せない。
 */
type Burnt = {
  readonly id: string;
  readonly status: "burnt";
  readonly kind: Kind;
  /** 焼き加減をGrillingから引き継ぐ */
  readonly heatSeconds: Readonly<Record<Side, number>>;
};

/**
 * どの状態か分からない串。全状態を列挙した型でもある。
 * すべての串の状態を網羅しているため、Skewer 型の値は必ずどれかの状態に属する。
 */
type Skewer = Raw | Grilling | Undercooked | Perfect | Burnt;

// 既存の状態の切り出し =========================================

/**
 * 味付けしていない串。
 */
type Unseasoned = Perfect & {
  readonly seasoning: null;
};

/**
 * 味付けした串。
 */
type Seasoned = Perfect & {
  readonly seasoning: Seasoning;
};

/**
 * 猫が食べられる串。猫には、塩分とネギは毒
 */
type CatSafe = Unseasoned & {
  readonly kind: Exclude<Kind, "negima">;
};

/**
 * 焼き直し可能な串。
 */
type Grillable = Raw | Undercooked;

// ========================================= 既存の状態の切り出し

/**
 * 串の種類ごとの焼け方。
 * 設定値。ゲームバランスの調整パラメータ
 */
type CookProfile = {
  readonly perfectFromSeconds: number;
  readonly burntFromSeconds: number;
};

/**
 * 注文の種類、味付け、配置時刻
 * 串と独立したエンティティ
 */
type Order = {
  readonly id: string;
  readonly kind: Kind;
  readonly seasoning: Seasoning;
  readonly placedAt: number;
};

/**
 * 提供の結果。お客さんに出して、受け取ってもらえたかどうか。（関数の戻り値として使う）
 *
 * ok を判別子にした判別可能なユニオン型。Skewer が status で分かれているのと同じ構造で、
 * 成功と失敗で持てるフィールドを変えている。
 *
 * 1つの型にまとめて全部オプショナルにすると { ok: false, revenue: 500 } が書けてしまう。
 * 分けておくと読む側も楽で、if (result.ok) の中では revenue が number として確実にある。
 */
type ServeResult =
  | {
      readonly ok: true;
      /** 売上。閉店画面の集計に使う */
      readonly revenue: number;
      /** 焼き加減の点数。完璧に近いほど高い。 */
      readonly quality: number;
    }
  | {
      readonly ok: false;
      /** 注文と何が違ったか */
      readonly reason: "wrong-kind" | "wrong-seasoning";
    };

// Why not: 失敗理由に「生焼け」「焦げ」を入れていない。serve() の引数が Seasoned なので
//   それらの串はそもそも渡せず、reason: "undercooked" に到達するコードが書けないため。
//
//   焦げた串を伝票にドラッグすること自体はできる。それを止めるのは drop() の仕事で、
//   型ガードで絞り込み、通ったものだけ serve() に渡す。
//   引数を Seasoned に絞ったぶん、serve() が実行時に見る範囲は
//   「種類が違う」「味付けが違う」の2つに狭まっている。
//   型で防げている範囲は、実行時に防ぎ直さなくてよい。

// Why not: reason を string にしなかった。リテラルの union にしておくと、
//   UI で理由ごとに違う演出（猫が鳴く、客が怒る）を出すとき switch の書き漏れを
//   コンパイラが見つけてくれる。string だと as const を忘れたときと同じで、
//   型が何も仕事をしなくなる。
