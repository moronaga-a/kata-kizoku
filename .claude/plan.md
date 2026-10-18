# 型貴族 実装計画

焼き鳥の状態を TypeScript の型で表現する、焼き鳥屋さんゲーム。社内開発コンテスト向け。

## 目的

- TypeScript の型システム（判別可能なユニオン型、型ガード、ユーティリティ型）を、手を動かして身につける
- 「不正な状態は型で表現できない」という設計を、ゲームという分かりやすい形で見せる
- 発表では「Ruby ならこう書くところを、TS ではこう型で守れる」という比較をストーリーにする

## 分担

| 領域 | 担当 | 理由 |
|---|---|---|
| 型定義、状態遷移、型ガード、注文ロジック | 自分 | 型の学びが最も濃い部分 |
| ロジックのテスト | 自分 | 型と振る舞いの両方を確かめる練習になる |
| ドロップ時の分岐処理（`drop()`） | 自分 | 型の絞り込み（narrowing）が一番出てくる、UI とロジックの境界 |
| 描画、ドラッグ操作、canvas（炭火・煙）、CSS、音、猫のアニメーション | AI | 型の学びが少なく、見た目の作り込みに時間がかかる部分 |

ルールとして、AI に作ってもらうコードは `src/ui/` 以下だけにし、`src/domain/` と `src/game/` には手を入れてもらわない。UI はロジックの関数を呼ぶだけ、という境界を守る。

## 技術スタック

- Vite + TypeScript（フレームワークなしの素の DOM）
- Vitest（ロジックのテスト）
- canvas 2D（炭火と煙）、Web Audio（焼ける音）
- tsconfig は `strict` に加えて `noUncheckedIndexedAccess`、`noImplicitReturns`、`noFallthroughCasesInSwitch`、`verbatimModuleSyntax` を有効にする

## ディレクトリ構成

```
kata-kizoku/
├── index.html
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── domain/          ← 自分
│   │   ├── types.ts       状態の型、CookProfile、Order、ServeResult
│   │   ├── skewer.ts      遷移関数、型ガード、表示用の typeName
│   │   └── orders.ts      注文の生成、残り時間
│   ├── game/            ← 自分
│   │   ├── state.ts       ゲーム全体の状態（スコア、注文、串の一覧）
│   │   └── drop.ts        ドロップ先ごとの分岐
│   ├── ui/              ← AI
│   │   ├── render.ts      串・伝票・型ビューの描画
│   │   ├── drag.ts        Pointer Events によるドラッグ
│   │   ├── grill.ts       炭火と煙の canvas
│   │   ├── cat.ts         猫のリアクション
│   │   └── audio.ts       焼ける音、効果音
│   ├── main.ts            起動とゲームループ
│   └── style.css
└── tests/
    └── domain/
        ├── skewer.test.ts
        └── orders.test.ts
```

## 型設計の要点

状態は `status` を判別子にしたユニオン型で表す。状態ごとに持てるフィールドを変えることで、ありえない状態を作れないようにする。

```ts
type Skewer = Raw | Grilling | Undercooked | Perfect | Burnt;

type Grillable  = Raw | Undercooked;
type Unseasoned = Perfect & { readonly seasoning: null };
type Seasoned   = Perfect & { readonly seasoning: Seasoning };
type CatSafe    = Unseasoned & { readonly kind: Exclude<Kind, "negima"> };
```

遷移関数は「型 → 型」の純粋関数にする。引数の型が「その操作をしてよい状態」を表す。

| 関数 | 引数 | 戻り値 |
|---|---|---|
| `placeOnGrill` | `Grillable` | `Grilling` |
| `tick` | `Grilling`, 火力, 経過秒 | `Grilling \| Burnt` |
| `flip` | `Grilling` | `Grilling` |
| `takeOff` | `Grilling` | `Undercooked \| Perfect \| Burnt` |
| `season` | `Unseasoned`, `Seasoning` | `Seasoned` |
| `serve` | `Seasoned`, `Order` | `ServeResult` |
| `feedCat` | `CatSafe` | `void` |

UI から渡ってくるのは `Skewer`（どの状態か分からない値）なので、`isGrillable`、`isUnseasoned`、`isSeasoned`、`isCatSafe` の型ガードで絞り込んでから遷移関数を呼ぶ。`switch` の `default` では `assertNever` を使い、状態を増やしたときの書き忘れをコンパイラに検出させる。

## フェーズ

見積もりは合計 20〜30 時間。集中して作業できるのが 1 日 6 時間程度なら 4〜5 日。

### フェーズ 0：環境構築（1〜2 時間）✅ 完了

- [x] Vite + TypeScript の足場を作る
  - `npm create vite@latest` は使わなかった。既に `.git` と `.claude/plan.md` が
    あるディレクトリで実行すると対話プロンプトが出て、選択を誤ると消えるため、
    設定ファイルを直接書いた
- [x] tsconfig に厳しめのオプションを追加する
  - 計画の 4 つに加えて `noUnusedLocals` / `noUnusedParameters` も有効にした
- [x] Vitest を入れて、空のテストが通ることを確認する（`tests/smoke.test.ts`）
- [x] 上のディレクトリ構成を作る

完了条件：`npm run dev` と `npx vitest` が動く。→ 両方とも確認済み。

導入したバージョン：TypeScript 7.0 / Vite 8.3 / Vitest 5.0。
TypeScript 7 はコンパイラが Go で書き直されたネイティブ版だが、今の tsconfig では問題なし。

### フェーズ 1：型定義（2〜3 時間）✅ 完了

- [x] `Kind` を `as const` の配列から導出する
- [x] `Raw`、`Grilling`、`Undercooked`、`Perfect`、`Burnt` を定義する
- [x] `Grillable`、`Unseasoned`、`Seasoned`、`CatSafe` を定義する
- [x] `CookProfile`、`Order`、`ServeResult` を定義する
- [x] 「生の串に `front` を書くとエラーになる」ことを実際に試して確かめる
  - 4 パターンで確認（余計なプロパティ / 足りないプロパティ / ねぎまを `CatSafe` に /
    `ok: false` に `revenue`）

完了条件：`tsc --noEmit` が通り、ありえない状態を書こうとすると型エラーになる。→ 達成。

#### 実装時に決めたこと（計画になかった判断）

- **`Side` 型を追加**：`"front" | "back"`。`facing` と `heatSeconds` の 2 箇所で使う。
  `Kind` と違い増えないので `as const` からは導出していない
- **焼き加減はラベルではなく量で持つ**：`Grilling` は
  `heatSeconds: Readonly<Record<Side, number>>` を持ち、生焼け・完璧・焦げの判定は
  `takeOff()` が `CookProfile` と突き合わせて行う。
  ラベルを直接持たせると `tick()` が積み上げる先がなく時間が進まない、
  かつ「焦げながら焼き中」が書けてしまうため
- **`Perfect.seasoning` は `Seasoning | null`**：`Seasoning` だけにすると
  `Unseasoned = Perfect & { seasoning: null }` が `never` に潰れて一生作れなくなる。
  オプショナル（`?:`）では `undefined` になるので救われない
- **`Order.placedAt` は `number`（タイムスタンプ）**：`Date` はメソッドで中身を
  書き換えられ、`Readonly<Date>` でも防げないため。残り時間は計算で出す
- **`ServeResult` の失敗理由は「種類違い」「味付け違い」の 2 つだけ**：
  `serve()` の引数が `Seasoned` なので、生焼け・焦げ・味付けなしは渡せず、
  実行時に判定する必要がない。それらを弾くのは `drop()` の仕事

#### 保留にした判断（フェーズ 2 で決める）

- 客の待ち時間（制限時間）をどこに持つか。`Order` のフィールドか、全員一律の定数か
- `Order.seasoning` の `null` の意味（味付け指定なし / 素焼きの注文）
- ~~`heatSeconds` を `Record<Side, number>` にしたが、`tick()` で
  `{ ...s.heatSeconds, [s.facing]: v }` の型が通らなければ平らに持つ形に戻す~~
  → **フェーズ 2 で解決。型は通った。** キーが union の計算プロパティでも
  `Readonly<Record<Side, number>>` に代入できる。読みも書きも分岐なしで済む形になった

### フェーズ 2：状態遷移と型ガード（4〜6 時間）

- [ ] `PROFILES: Record<Kind, CookProfile>` で串の種類ごとの焼け方を定義する
- [ ] `placeOnGrill`、`tick`、`flip`、`takeOff`、`season`、`serve` を実装する
- [ ] 型ガード 4 つを実装する
- [ ] `quality()` で焼き加減の点数を出す
- [ ] 猫に断られる理由を返す `catRefusal()` を実装する
- [ ] `typeName()` と `availableActions()` を `assertNever` 付きで実装する
- [ ] `orders.ts` で注文の生成と残り時間の計算を実装する

完了条件：すべての関数が `any` なしで書けていて、`tsc` が通る。

### フェーズ 3：ロジックのテスト（2〜3 時間）

- [ ] 生 → 焼き中 → 焼き上がり → 味付け → 提供、の一連の流れ
- [ ] 焼きすぎると `Burnt` になる境界値
- [ ] 片面だけ焼いて下ろすと `Undercooked` になる
- [ ] 注文と種類や味付けが違うと `ServeResult` が `ok: false` になる
- [ ] ねぎまは `isCatSafe` が `false` になる
- [ ] `// @ts-expect-error` を使って「生の串は `serve` に渡せない」ことをテストに残す

完了条件：テストがすべて通る。`@ts-expect-error` のテストで型の制約そのものも検証できている。

### フェーズ 4：AI に UI を作ってもらう（2〜3 時間）

フェーズ 1〜3 のコードを AI に渡し、`src/ui/` 以下を作ってもらう。依頼文の例：

> `src/domain/` の型と関数を使って、`src/ui/` 以下に焼き鳥ゲームの UI を作ってください。`src/domain/` と `src/game/` は変更しないでください。ドロップが起きたら `src/game/drop.ts` の `drop(entity, target)` を呼ぶだけにしてください。描画、ドラッグ、炭火と煙の canvas、猫のアニメーション、音をお願いします。見た目はプロトタイプと同じ、藍色の暖簾と炭火の配色で。

- [x] 渡す前に `drop()` のシグネチャと `DropTarget` 型だけ先に決めておく
  - `DropResult` も先に決めた。UI が「結果どうなったか」を知る必要があるため
- [x] 出てきたコードが `domain` に手を入れていないか確認する → 無傷
- [x] `any` や型アサーション（`as`）が多用されていないか確認する
  - `grep` で 4 件。うち 1 件は本物の型アサーション（`dataset` の `string` を
    `PieceType` だと言い張っていた）。残り 3 件は `as const` で、
    値の後ろの `as` を変数の前の型注釈に移すだけで消えた。4 件とも除去済み

完了条件：ドロップ以外の操作（ドラッグ、描画、焼ける様子）が画面で動く。→ 達成。

実装したもの：`index.html` / `src/style.css` / `src/ui/`（audio, cat, grill, render, drag）/ `src/main.ts`。
プロトタイプ（`.claude/kata-kizoku.html`）の HTML と CSS をベースにした。
日本語の文言はすべて UI 側に置き、`Record<Kind, string>` /
`Record<CatRefusalReason, string>` にしてラベルの書き忘れがコンパイルエラーになるようにした。

### フェーズ 5：`drop()` の実装（3〜4 時間）✅ 完了

- [x] `DropTarget` を判別可能なユニオン型で定義する（焼き台、まな板、味付け、捨てる、猫、伝票、なし）
- [x] ドロップ先で `switch` し、型ガードで串の状態を絞り込んでから遷移関数を呼ぶ
- [x] 焼き台から離すときは先に `takeOff` する
- [x] 型が合わないときはコンパイラ風のエラーメッセージをログに出す
- [x] 招き猫効果（猫にあげると次のお客さんがすぐ来る）を入れる

完了条件：一連の操作がすべて画面上でつながり、型エラーのメッセージが正しく出る。→ 達成。

#### 実装時に決めたこと

- **焼き台だけ `switch` の前に出した**。唯一「下ろさずに扱う」ドロップ先なので、
  先に片付けると `liftOffGrill` の戻り値から `Grilling` が消え、
  以降の `case` で「焼き中かもしれない」を考えなくてよくなる。
  最初は `switch` の前で三項演算子を使っていたが、`case "board"` で
  「`Grilling` が残っているかもしれない」と判断されて型が通らなかった。
  コンパイラは2つの変数をまたいだ関係を追えないため。`as` で黙らせず構造を変えた
- **失敗は2種類**。`type-error`（そもそも渡せない串）と `wrong-order`（渡せたが注文と違う）
- **猫の理由は `DropResult` に載せなかった**。UI が `catRefusal()` を呼んで聞く。
  `catRefusal` はねぎまを最優先し、焼き加減はまとめて `"not-ready"` にするので、
  下ろす前の串で聞いても答えは変わらない

### フェーズ 6：結合と調整（4〜6 時間）

- [ ] 焼ける速さ、火力の差、お客さんの待ち時間を遊びながら調整する
- [ ] スマホのタッチ操作で動くか確認する
- [x] 閉店画面の集計（売上、提供数、帰った客、型エラー回数、猫にあげた本数）
- [ ] README に型設計の説明を書く

完了条件：最初から最後まで遊べて、他の人に触ってもらっても迷わない。

#### 後回しにしたこと

- **`drop()` のテスト**。フェーズ3でテストを書いた時点では `drop()` が存在しなかった。
  7分岐＋型ガードの塊で、型が守ってくれない部分の集合体なので書く価値が高い。
  `Skewer` / `DropTarget` / `orders` を受け取って `DropResult` を返す純粋関数なので、
  DOM なしでテストできる。バランス調整で壊したときに気づけるよう、調整の前に書きたい
  - 型ガードの条件が正しいか（`isGrillable` から `"raw"` が抜けても tsc は黙っていた前例あり）
  - `liftOffGrill` が本当に下ろしているか
  - 注文が見つからないときに `"none"` を返すか
  - `serve` の失敗が `wrong-order` に変換されるか
- **`main.ts` のゲーム状態を `src/game/state.ts` に移す**。いまは `main.ts` が
  `GameState` を直接持っている

## 発表で見せたいポイント

1. 型ビュー：串を選ぶと、今の状態が `const skewer: Grilling = {...}` の形でリアルタイムに表示される
2. 型エラー：生焼けの串を伝票に出すと、コンパイラそのものの言い回しで怒られる
3. `CatSafe`：`Exclude` とインターセクションで「猫にあげてよい串」を型で表す。ネギ類は本当に猫に毒なので、型が現実の安全ルールを守っている、という話ができる
4. `assertNever`：状態を一つ増やして、書き忘れた `case` がコンパイラに指摘される様子をライブで見せる
5. Rails との比較：Ruby ではバリデーションやテストで実行時に守っていたものが、TS では書いた瞬間に守られる

## リスクと対策

| リスク | 対策 |
|---|---|
| 型エラーの意味が分からず止まる | エラーメッセージを AI に貼って「なぜ」を説明してもらう。答えのコードはもらわない |
| AI の UI コードが `domain` に入り込む | ディレクトリで境界を分け、依頼文で明示する。差分を必ず確認する |
| 見た目の作り込みに時間を取られる | UI の調整は AI に任せ、自分の時間はロジックとテストに使う |
| ゲームバランスの調整が終わらない | 数値は `PROFILES` に集約して、コードを触らず調整できるようにする |

## 余裕があれば追加したいもの

- 焼いている途中にタレを塗る工程（`Grilling` に `basted` を持たせる）
- お客さんのランク（型平民、型男爵、型公爵）
- 串の種類の追加（`Kind` を増やすと `Record` の設定漏れが型エラーになることを見せられる）
- XState などを使った状態機械との比較