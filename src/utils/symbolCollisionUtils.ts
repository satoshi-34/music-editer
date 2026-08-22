// src/utils/symbolCollisionUtils.ts
// 記号と音符の自動衝突回避（Issue #340・段1）。
//
// 背景:
// 強弱記号（pp など）や cresc./dim. の縦位置は「五線最下線から固定オフセット下」で、
// 低い音符・加線・下向きの符幹はそこまで届くため重なっていた（月光の pp を手動で
// -93px 動かした実例が発端。弟インタビュー回答1の筆頭）。
//
// 方針（Issue #340 の設計メモ 2026-08-22）:
// - DOM を触らない純粋関数だけを置く（jsdom でもテストできるよう、障害物は
//   VexFlow の BoundingBox（モデル側で取れる）から呼び出し側が作って渡す）
// - 手動調整（⤢/✥ の offsetX/offsetY が非0）の記号は自動回避の対象外。
//   ただし他の記号からは「既に置かれているもの」として避けられる
// - 自動回避の結果は保存しない（描画のたびに計算。保存データは常に不変なので、
//   後からこのロジックを改良しても既存の譜面が壊れない）

/** 長方形1つぶん（SVG 論理座標系。y は上端、下向きが正） */
export interface CollisionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 五線の下側に置く記号1件ぶんの入力 */
export interface BelowSymbolInput {
  /** 予定位置の描画範囲（手動調整の offsetX/offsetY 適用後） */
  rect: CollisionRect;
  /** 手動調整済みか。true なら自動では動かさない（占有域としてだけ扱う） */
  hasManualOffset: boolean;
}

export interface BelowSymbolAvoidanceOptions {
  /** 1回の押し出し量（px）。小さいほど詰まるが試行回数が増える */
  stepPx?: number;
  /** 自動で押し出す上限（px）。極端なケースは従来どおり手動調整に委ねる */
  maxShiftPx?: number;
  /** 記号と障害物の間にあける余白（px） */
  padPx?: number;
}

export const BELOW_SYMBOL_STEP_PX = 7;
/**
 * 自動押し出しの上限。実例（月光 pp の手動 -93px）を上回る 112px（= 7px × 16 回）
 * まで許し、それでも空かない極端なケースは重なったまま（手動調整に委ねる）。
 */
export const BELOW_SYMBOL_MAX_SHIFT_PX = 112;
export const BELOW_SYMBOL_PAD_PX = 2;

/** 余白 pad を含めた AABB の交差判定 */
export function rectsIntersect(a: CollisionRect, b: CollisionRect, pad: number = 0): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

/**
 * 五線の下側に置く記号たちの「下方向の追加オフセット」を求める。
 *
 * 決め方:
 * 1. 記号を x 順に処理し、障害物（音符・符幹・加線の BoundingBox）と
 *    既に確定した記号の占有域のどれかに重なる間、step ずつ下へ押し出す
 * 2. maxShift まで押しても空かなければ、それ以上は押さない（重なったまま）。
 *    無限に下がって次の段へ食い込むより、目で気づける重なりの方がまし
 * 3. 手動調整済みの記号は動かさない（シフト 0）。ただし占有域には加えるので、
 *    自動配置の記号の方が手動配置を避ける
 *
 * 戻り値は入力と同じ並び順の「追加 dy（0 以上）」。
 */
export function resolveBelowSymbolShifts(
  symbols: BelowSymbolInput[],
  obstacles: CollisionRect[],
  options?: BelowSymbolAvoidanceOptions,
): number[] {
  const step = options?.stepPx ?? BELOW_SYMBOL_STEP_PX;
  const maxShift = options?.maxShiftPx ?? BELOW_SYMBOL_MAX_SHIFT_PX;
  const pad = options?.padPx ?? BELOW_SYMBOL_PAD_PX;

  // 処理順は x 順（左の記号から確定させる）。ただし戻り値は入力順を保つ
  const order = symbols
    .map((symbol, index) => ({ symbol, index }))
    .sort((a, b) => a.symbol.rect.x - b.symbol.rect.x);

  const occupied: CollisionRect[] = [];
  const shifts = new Array<number>(symbols.length).fill(0);

  for (const { symbol, index } of order) {
    if (symbol.hasManualOffset) {
      occupied.push(symbol.rect);
      continue;
    }
    let dy = 0;
    const collides = (candidate: CollisionRect): boolean =>
      obstacles.some((obstacle) => rectsIntersect(candidate, obstacle, pad)) ||
      occupied.some((other) => rectsIntersect(candidate, other, pad));
    while (dy < maxShift && collides({ ...symbol.rect, y: symbol.rect.y + dy })) {
      dy += step;
    }
    // maxShift に達してもまだ重なるなら、押し出しは諦めて元の位置に戻す
    // （中途半端に下がった位置は「避けたのに重なっている」ように見えて紛らわしい）
    if (dy >= maxShift && collides({ ...symbol.rect, y: symbol.rect.y + dy })) {
      dy = 0;
    }
    shifts[index] = dy;
    occupied.push({ ...symbol.rect, y: symbol.rect.y + dy });
  }
  return shifts;
}

/**
 * テキスト記号の描画範囲を見積もる。DOM に入れる前は実測できないため、
 * フォントサイズと文字数からの概算で衝突判定に使う（等幅ではないので
 * 平均文字幅係数 0.62 を掛ける。強弱記号は1〜5文字程度なので誤差は数px）。
 *
 * 縦方向は em 全体ではなく**字面の実コア**（ベースライン上 0.55em・下 0.2em）で
 * 見積もる。em 全体で判定すると、通常音域の下向き符幹の先端が箱の上端を
 * 1〜2px かすめるだけで押し出しが発生し、譜面全体で強弱記号の高さが不揃いに
 * なってしまう（意味のある重なりだけを避けたい）。
 */
export function estimateTextRect(
  centerX: number,
  baselineY: number,
  text: string,
  fontSizePx: number,
): CollisionRect {
  const w = Math.max(fontSizePx * 0.62, text.length * fontSizePx * 0.62);
  return { x: centerX - w / 2, y: baselineY - fontSizePx * 0.55, w, h: fontSizePx * 0.75 };
}
