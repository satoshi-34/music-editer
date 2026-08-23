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
  // 公開オプションは正の有限値だけを受け付け、不正値は既定値で置き換える
  // （stepPx=0 は無限ループ、負値・NaN は挙動未定義になるため。Codex round1 P3）
  const step = Number.isFinite(options?.stepPx) && (options?.stepPx as number) > 0
    ? (options?.stepPx as number)
    : BELOW_SYMBOL_STEP_PX;
  const maxShift = Number.isFinite(options?.maxShiftPx) && (options?.maxShiftPx as number) >= 0
    ? (options?.maxShiftPx as number)
    : BELOW_SYMBOL_MAX_SHIFT_PX;
  const pad = Number.isFinite(options?.padPx) ? (options?.padPx as number) : BELOW_SYMBOL_PAD_PX;

  const shifts = new Array<number>(symbols.length).fill(0);
  const occupied: CollisionRect[] = [];

  // 手動調整済みの記号は位置が確定しているので、先に全件を占有域へ登録する。
  // 処理順で後になった手動記号を自動記号が知らずに重なってしまうため、
  // 「手動を先に全部・自動をその後で」の2段構えにする（Codex round1 P2）
  for (const symbol of symbols) {
    if (symbol.hasManualOffset) occupied.push(symbol.rect);
  }

  // 自動配置の記号だけを x 順（左から確定）で処理する。戻り値は入力順を保つ
  const autoOrder = symbols
    .map((symbol, index) => ({ symbol, index }))
    .filter(({ symbol }) => !symbol.hasManualOffset)
    .sort((a, b) => a.symbol.rect.x - b.symbol.rect.x);

  for (const { symbol, index } of autoOrder) {
    let dy = 0;
    const collides = (candidate: CollisionRect): boolean =>
      obstacles.some((obstacle) => rectsIntersect(candidate, obstacle, pad)) ||
      occupied.some((other) => rectsIntersect(candidate, other, pad));
    // maxShift を超えないよう clamp しながら押し出す（step が maxShift を
    // 割り切れない値でも上限内に収まる）
    while (dy < maxShift && collides({ ...symbol.rect, y: symbol.rect.y + dy })) {
      dy = Math.min(dy + step, maxShift);
    }
    // 上限まで押してもまだ重なるなら、押し出しは諦めて元の位置に戻す
    // （中途半端に下がった位置は「避けたのに重なっている」ように見えて紛らわしい）
    if (collides({ ...symbol.rect, y: symbol.rect.y + dy })) {
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
  /** 実測・メタデータ由来の幅が分かっている場合の明示指定（px）。文字数概算より優先 */
  explicitWidthPx?: number,
): CollisionRect {
  const w = explicitWidthPx != null && explicitWidthPx > 0
    ? explicitWidthPx
    : Math.max(fontSizePx * 0.62, text.length * fontSizePx * 0.62);
  return { x: centerX - w / 2, y: baselineY - fontSizePx * 0.55, w, h: fontSizePx * 0.75 };
}
