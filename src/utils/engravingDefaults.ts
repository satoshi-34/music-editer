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
} as const;

/**
 * 選択中の松葉を太く見せるときの倍率。
 * 変更前は 1.2 u に対して 1.8 u（= 1.5 倍）だったので、その比率をそのまま引き継ぐ。
 */
export const SELECTED_LINE_EMPHASIS_RATIO = 1.5;

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
  return true;
}
