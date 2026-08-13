// 浄書（楽譜の組版）の既定値をまとめた、値の正本。
//
// Issue #202: #195 の A/B 比較で選定者が「候補A（Bravura engravingDefaults 準拠）」を
// 選んだため、その値をアプリの既定値として適用する。
// 比較に使ったスニペット（docs/qa/engraving-defaults/ab-preview.js）の `PRESETS.a` と
// 同じ値をここに集約し、描画側はこのファイルだけを参照する。
//
// 【なぜ1ファイルに集めるか】
// 太さや文字サイズは App.css・PianoSystemCanvas・各 *RenderUtils に散らばっていて、
// 「いま何 sp なのか」を追うのに全部を読む必要があった（#195 の調査で判明）。
// 浄書の値は「五線間隔に対する比率」で決まる体系なので、比率のまま1か所に置く。
//
// 【単位のはなし】
// - **sp（staff space, 五線間隔）**: 五線の線と線の間隔。浄書の世界の基準単位で、
//   Bravura（このアプリが使う楽譜フォント）の推奨値もこの単位で定義されている
// - **u（SVG論理単位）**: VexFlow が描くときの座標単位。このアプリでは **1 sp = 10 u**
//
// 出典: Bravura 1.481 の `engravingDefaults`（<https://github.com/steinbergmedia/bravura>）。
// 各値の意味と現状からの乖離は `.claude/specs/engraving-defaults/design.md` を参照。

/** 五線間隔（1 sp）が SVG 論理単位でいくつぶんか。VexFlow の描画スケールの前提値。 */
export const UNITS_PER_STAFF_SPACE = 10;

/** sp（五線間隔比）を SVG 論理単位へ換算する。 */
export function spToUnits(sp: number): number {
  return sp * UNITS_PER_STAFF_SPACE;
}

/**
 * 線の太さ（単位 sp）。候補A = Bravura の engravingDefaults にそろえた値。
 *
 * `stem` だけは現状値と同じ（0.12）だが、「変えない」という判断も値の一部なので
 * ここに並べておく（App.css の一律指定を分解したときに符幹が太らないようにするため、
 * 明示的な指定が必要になる）。
 */
export const ENGRAVING_THICKNESS_SP = {
  /** 五線の5本線。Bravura: staffLineThickness */
  staffLine: 0.13,
  /** 符幹（音符の棒）。Bravura: stemThickness。現状と同値で据え置き */
  stem: 0.12,
  /** 加線（五線の外へ出た音に足す短い線）。Bravura: legerLineThickness */
  ledger: 0.16,
  /** 通常の小節線。Bravura: thinBarlineThickness */
  thinBarline: 0.16,
  /** 松葉（クレッシェンド／デクレッシェンド）。Bravura: hairpinThickness */
  hairpin: 0.16,
  /**
   * セクション内の細いサブ括弧（弦のなかで Vln.I / Vln.II をまとめる等）。
   * Bravura: subBracketThickness。
   *
   * 注意: 総譜の左端に出る「太いメイン括弧」は VexFlow の StaveConnector が
   * 幅 3 u（= 0.30 sp）の rect で描いており、この値の対象ではない。
   * トリアージ表の「ブラケット 現状 0.12」は 0.12 sp で描かれているサブ括弧を
   * 指しているため、ここではサブ括弧だけを 0.16 sp へそろえる。
   * メイン括弧（0.30 sp）を Bravura 推奨の 0.50 sp へ太らせるかは未決定事項。
   */
  subBracket: 0.16,
  /** リハーサルマークなど、文字を囲む枠線。Bravura: textEnclosureThickness */
  textEnclosure: 0.16,
} as const;

/**
 * 譜面内に描く文字の大きさ（単位 sp）。
 * 譜面サイズ（音符の大きさ）に追従させたいので px ではなく sp で持つ。
 */
export const ENGRAVING_TEXT_SP = {
  /** パート名（Flute / Fl.）。#195 の調査で「小さすぎる」と判定された最優先項目 */
  instrumentLabel: 1.7,
  /**
   * パート数が多い総譜でのパート名。1段の高さが低く、大きい文字だと
   * 隣の段のラベルとぶつかるため小さめにする（従来の 11 u / 9 u と同じ比率を保つ）。
   */
  instrumentLabelDense: 1.39,
  /** 小節番号 */
  measureNumber: 1.4,
  /** 歌詞 */
  lyrics: 1.5,
  /** 強弱記号（f, p など）。cresc./dim. とテンポ表記も同じ比率で拡大する */
  dynamics: 2.0,
  /** cresc. / dim. とテンポ表記（Allegro 等）。強弱記号と同じ 1.25 倍を掛けた値 */
  expressiveText: 1.5,
  /**
   * 運指（指番号）。Issue #232: 運用者が実機（月光の入力）で見比べて
   * **従来の 180%**（1.0 sp = 10 u → 1.8 sp = 18 u）を選定した実測値。
   *
   * 候補A（Bravura の engravingDefaults 準拠）由来ではなく運用者の選定値なので、
   * `ab-preview.js` の `PRESETS.a` との一致チェックの対象ではない。
   */
  fingering: 1.8,
} as const;

/** 線の太さ（SVG論理単位）。描画側はこちらを使う。 */
export const ENGRAVING_THICKNESS_UNITS = {
  staffLine: spToUnits(ENGRAVING_THICKNESS_SP.staffLine),
  stem: spToUnits(ENGRAVING_THICKNESS_SP.stem),
  ledger: spToUnits(ENGRAVING_THICKNESS_SP.ledger),
  thinBarline: spToUnits(ENGRAVING_THICKNESS_SP.thinBarline),
  hairpin: spToUnits(ENGRAVING_THICKNESS_SP.hairpin),
  subBracket: spToUnits(ENGRAVING_THICKNESS_SP.subBracket),
  textEnclosure: spToUnits(ENGRAVING_THICKNESS_SP.textEnclosure),
} as const;

/** 文字の大きさ（SVG論理単位）。描画側はこちらを使う。 */
export const ENGRAVING_TEXT_UNITS = {
  instrumentLabel: spToUnits(ENGRAVING_TEXT_SP.instrumentLabel),
  instrumentLabelDense: spToUnits(ENGRAVING_TEXT_SP.instrumentLabelDense),
  measureNumber: spToUnits(ENGRAVING_TEXT_SP.measureNumber),
  lyrics: spToUnits(ENGRAVING_TEXT_SP.lyrics),
  dynamics: spToUnits(ENGRAVING_TEXT_SP.dynamics),
  expressiveText: spToUnits(ENGRAVING_TEXT_SP.expressiveText),
  fingering: spToUnits(ENGRAVING_TEXT_SP.fingering),
} as const;

/**
 * 選択中の松葉を太く見せるときの倍率。
 * 変更前は 1.2 u に対して 1.8 u（= 1.5 倍）だったので、その比率をそのまま引き継ぐ。
 */
export const SELECTED_LINE_EMPHASIS_RATIO = 1.5;

// ───────────────────────────────────────────────────────────────
// 画面表示での「線の細さの下限（フロア）」（Issue #210）
// ───────────────────────────────────────────────────────────────
//
// 【何が問題だったか】
// 上の太さは「五線間隔に対する比率」なので、譜面を縮小すると線も同じ割合で細くなる。
// 編成譜は1段が高いぶん紙に収めるための自動縮小が強く掛かり（実測: 室内オーケストラ・
// ズーム50%で SVG論理単位1 が画面 0.191 px）、五線の実効太さが **0.248 px** まで落ちて
// モニタ上でかすれて見えなくなっていた（運用者報告 2026-08-09）。
//
// 【考え方】
// 「画面上の実効太さが下限を割ったら、下限を割った比率のぶんだけ全部の線を太らせる」
// という**1つの倍率**で表す。線種ごとに別々の下限へ丸めると
// 「五線＜小節線＜加線」という浄書の太さの階層が下限のところで潰れてしまうため、
// 全線に同じ倍率を掛けて**候補Aの相対比をそのまま保つ**（トリアージの指示どおり）。
//
// 【なぜ CSS px ではなくデバイスピクセル基準か】
// 「1 CSS px」を下限にすると、単旋律・ピアノの 100%表示（実効 0.745 px）まで
// 太らせてしまい、運用者が #195 で「現状で良い」と判定した見た目が変わってしまう。
// かすれの原因は「1つのデバイスピクセルを塗り切れないこと」なので、下限も
// デバイスピクセルで決める（Retina = dpr 2 なら 1 デバイスピクセル = 0.5 CSS px）。
// これで単旋律・ピアノ（1.49 デバイスピクセル）はフロアが発動せず、
// 編成譜の縮小表示（0.50 デバイスピクセル）だけが救われる。

/** 五線の実効太さの下限（デバイスピクセル）。これを割った表示にだけフロアが効く。 */
export const MIN_STAFF_LINE_DEVICE_PX = 1;

/**
 * フロアで太らせてよい上限の倍率。
 *
 * 極端に縮小した大編成（例: 40段の総譜をズーム50%）では、下限まで太らせると
 * 五線の5本が1本の黒帯に潰れてしまう。そこで「五線がこの譜面でいちばん太い線
 * （終止線の太線・総譜のメイン括弧 = 0.30 sp）より太くはならない」ところで頭打ちにする。
 * かすれ対策として弱くなる代わりに、黒く塗り潰れる壊れ方はしない。
 */
export const MAX_SCREEN_STROKE_FLOOR_MULTIPLIER = 0.3 / ENGRAVING_THICKNESS_SP.staffLine;

/**
 * 画面表示での線の太さのフロア倍率を求める（1 なら発動しない＝従来どおり）。
 *
 * @param totalDisplayScale SVG論理単位1つが画面上の何 CSS px になるか。
 *   VexFlow の描画倍率（`SCORE_LAYOUT_RENDER_SCALE` ×「音符の大きさ」実効倍率）と、
 *   ページ全体に掛かる CSS の `transform: scale()`（自動縮尺 ×「画面表示のズーム」）の**積**。
 * @param strokeWeightScale 表示ウェイト設定（細/標準/太）の倍率。標準が 1。
 *   フロアは「ウェイトを適用したあとの実効値」に掛ける（細を選んだ意図は尊重しつつ、
 *   読めない細さだけを防ぐ、というトリアージの指示による）。
 * @param devicePixelRatio 画面の devicePixelRatio。Retina なら 2。
 */
export function computeScreenStrokeFloorMultiplier(params: {
  totalDisplayScale: number;
  strokeWeightScale?: number;
  devicePixelRatio?: number;
}): number {
  const { totalDisplayScale, strokeWeightScale = 1, devicePixelRatio = 1 } = params;
  // 壊れた値（0・負・NaN）が来ても「フロアを掛けない」に倒す。
  // 太さの計算で 0 除算を起こすより、従来どおりの見た目のほうが安全なため。
  if (!Number.isFinite(totalDisplayScale) || totalDisplayScale <= 0) return 1;
  if (!Number.isFinite(strokeWeightScale) || strokeWeightScale <= 0) return 1;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;

  const minCssPx = MIN_STAFF_LINE_DEVICE_PX / dpr;
  const actualCssPx = ENGRAVING_THICKNESS_UNITS.staffLine * strokeWeightScale * totalDisplayScale;
  if (actualCssPx >= minCssPx) return 1;
  return Math.min(minCssPx / actualCssPx, MAX_SCREEN_STROKE_FLOOR_MULTIPLIER);
}

/**
 * 譜面まわりのテキスト書体。
 *
 * Bravura のメタデータは、組み合わせるテキスト書体としてセリフ体
 * （Academico / Century Schoolbook / Edwin / serif）を推奨している。
 * 変更前はタイトルがゴシック体・譜面内が sans と serif の混在だったため、
 * セリフ体に寄せて統一する。
 *
 * **重要**: この書体を「SVG の text すべて」へ CSS で当ててはいけない。
 * 音楽記号（符頭・音部記号・括弧の上下端）は Bravura のグリフを `<text>` で描いており、
 * しかも総譜の括弧の上下端グリフは `g.vf-*` の外（SVG直下）に出るため、
 * まとめて書体を差し替えると豆腐（□）になる。
 * そのため「アプリが自分で描く文字」だけに、描画時この定数を指定する。
 *
 * 同じ書体はページ側の文字（タイトル・サブタイトル・作者欄）にも使う。
 * そちらは HTML なので App.css の `--score-text-font` に同じ並びを書いてある
 * （`engravingDefaults.test.ts` が両者の一致を見張る）。
 */
export const SCORE_TEXT_FONT_FAMILY = '"Century Schoolbook", Georgia, "Times New Roman", serif';

/**
 * VexFlow が塗り矩形で描く縦線に付ける目印のクラス名。
 *
 * これらの rect は `ctx.fillRect()` の塗りなので、太さを CSS の `stroke-width` では変えられない。
 * 一方で **`width` は CSS のジオメトリプロパティとして上書きできる**ので、
 * 画面表示のフロア（Issue #210）は App.css 側でこのクラスに対して掛けている。
 * こうしておくと、印刷（`@media print` でフロアを 1 に戻す）や
 * 「画面表示のズーム」の変更に、譜面を描き直さずに追従できる。
 */
export const VF_THIN_LINE_RECT_CLASS = 'vf-engraving-thin-line';
/** 終止線の太線・総譜のメイン括弧（VexFlow が幅 3 u の塗り矩形で描くもの）の目印。 */
export const VF_THICK_LINE_RECT_CLASS = 'vf-engraving-thick-line';

/**
 * VexFlow が幅 1 u の rect で描く「細い縦線」を、候補Aの小節線の太さへ広げる。
 *
 * VexFlow は小節線・段の左右の縦線を `ctx.fillRect(x, y, 1, h)` でハードコードしており、
 * rect の幅は CSS では変えられない（stroke ではなく塗りの矩形なので stroke-width が効かない）。
 * そのため描画後に幅を書き換える。線の中心がずれないよう x も半分だけ左へ戻す。
 *
 * @returns 実際に書き換えたら true（すでに書き換え済み・対象外なら false）
 */
export function widenThinBarlineRect(rect: Element): boolean {
  // 幅 1 の rect だけが VexFlow の「細い縦線」。終止線の太線（幅 3）などは対象外。
  if (rect.getAttribute('width') !== '1') return false;
  const x = Number.parseFloat(rect.getAttribute('x') ?? '');
  if (!Number.isFinite(x)) return false;
  const width = ENGRAVING_THICKNESS_UNITS.thinBarline;
  rect.setAttribute('width', String(width));
  rect.setAttribute('x', String(x - (width - 1) / 2));
  // 画面表示のフロア（Issue #210）を App.css から掛けるための目印。
  rect.classList.add(VF_THIN_LINE_RECT_CLASS);
  return true;
}

/**
 * 終止線の太線・総譜のメイン括弧（幅 3 u の塗り矩形）に、画面表示のフロア用の目印を付ける。
 *
 * 太さ自体は候補Aのままで変えない（#202 で「メイン括弧を太らせるかは未決定」としたため）。
 * ただしフロアの対象から外すと、細線だけが太って
 * **終止線の太線が通常の小節線より細くなる**という主従の逆転が起きるので、
 * 同じ倍率が掛かるようにここで目印だけ付けておく。
 *
 * @returns 目印を付けたら true（対象外なら false）
 */
export function markThickBarlineRect(rect: Element): boolean {
  if (rect.getAttribute('width') !== '3') return false;
  rect.classList.add(VF_THICK_LINE_RECT_CLASS);
  return true;
}
