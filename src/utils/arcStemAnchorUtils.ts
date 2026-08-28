/**
 * 多声部小節で、弧（タイ／スラー）の端点を「符頭側」と「符幹側」のどちらに
 * 付けるかを決める純ロジック（Issue #296）。
 *
 * 座標計算そのものは PianoSystemCanvas 側にあるが、
 * 「どちらに付けるか」「どれだけ離すか」という浄書上の決めごとだけを
 * ここへ切り出してテストで固定できるようにしている
 * （Issue #192 で `arcDirectionUtils.ts` を切り出したのと同じ考え方）。
 */

/**
 * 端点を符頭に付けるときの隙間（SVG 論理単位。五線の1間＝10）。
 *
 * 2026-08-29（Issue #446）: 3 → 6 へ広げた。
 * 3 は「符頭の中心から 3」なので、符頭の高さの半分（約 5）より内側で、
 * 弧の端が符頭にめり込んで見えていた（利用者フィードバック「タイが音符とくっつきすぎ」）。
 * 6 なら端点は符頭の縁（5）より外に出て、弧の線の太さ（端 0.10 sp ＝ 半分 0.5）を
 * 足しても符頭に触れない。浄書（Behind Bars）でもタイは符頭からわずかに離して描く。
 *
 * これ以上（7 以上）広げると、「線間にある音符」のタイの端が
 * 隣の五線の線を越えて見えるため、まずはここから始める。
 */
export const ARC_NOTEHEAD_GAP = 6;

/**
 * 手動で端点をずらした弧に使う、従来の隙間（SVG 論理単位）。
 *
 * ユーザーが端点ハンドルで位置を決めた弧まで一律に押し出すと、
 * 「せっかく合わせた位置が勝手に動く」ことになるため、
 * 手動調整済みの端点だけは従来の 3 を使い、保存されたオフセットの意味を保つ。
 */
export const ARC_NOTEHEAD_GAP_LEGACY = 3;

/**
 * 端点を符幹の先端に付けるときの隙間（SVG 論理単位）。
 *
 * 3 ではなく 5（＝五線の半間）にしているのは、**ビーム（連桁）をまたぐため**。
 * ビームで束ねられた音符の符幹は「ビームの中」で終わるので、符幹先端の座標は
 * ビームの厚み（VexFlow の既定で 5）のほぼ上端にある。3 しか離さないと
 * 端点がビームの帯の中に入ってしまう。5 離せば、いちばん外側のビームより
 * 確実に外へ出る（2本目以降のビームは符頭側へ内側に描かれるため、
 * 16分音符のように本数が増えても外側の位置は変わらない）。
 */
export const ARC_STEM_TIP_GAP = 5;

/**
 * その端点をユーザーが手動でずらしているか（Issue #446）。
 *
 * 保存値は「未調整（undefined）」と「調整したが結果ゼロ（0）」が混ざるので、
 * どちらも「動かしていない」とみなして既定の隙間を適用する。
 */
export function hasManualArcEndpointOffset(dx?: number, dy?: number): boolean {
  return (dx ?? 0) !== 0 || (dy ?? 0) !== 0;
}

/**
 * その弧の端点を符幹側へアンカーするかどうか。
 *
 * 条件は「多声部の小節」かつ「弧の向きと符幹の向きが同じ側」。
 *
 * - **多声部の小節だけ**にしているのは、単声部の譜面の見た目を1pxも変えないため
 *   （Issue #296 の「単声部小節の挙動は一切変えない」）。多声部では符幹の向きが
 *   声部で固定され（`resolveVoiceStemDirections`）、弧の向きも声部で固定される
 *   （Issue #192 の `resolveArcUpward`）ので、上声の弧は必ず符幹と同じ上側を通る。
 * - **向きが同じ側のときだけ**なのは、弧が符幹と反対側（＝符頭側）を通るときは
 *   従来どおり符頭に付けるのが浄書の定石だから。`flipDirection`（手動反転）で
 *   弧を裏返したときも、この条件が自動的に符頭アンカーへ戻してくれる。
 *
 * @param stemDirection VexFlow の符幹の向き（1 = 上向き / -1 = 下向き / 0 = 不明）
 */
export function shouldAnchorArcToStemSide(params: {
  isMultiVoiceMeasure: boolean;
  upward: boolean;
  stemDirection: number;
}): boolean {
  if (!params.isMultiVoiceMeasure) return false;
  return params.upward ? params.stemDirection > 0 : params.stemDirection < 0;
}

/**
 * 弧の端点のY座標を決める。
 *
 * @param noteheadY  端点になる符頭のY（五線位置から求めた値）
 * @param stemTipY   その音符の符幹先端のY（符幹が無い音符・取得できない場合は undefined）
 * @param upward     弧が上へふくらむか
 * @param anchorToStem `shouldAnchorArcToStemSide()` の結果
 * @param hasManualEndpointOffset その端点をユーザーが手動でずらしているか（Issue #446）。
 *        true なら隙間を広げず従来値のままにして、保存済みの位置を動かさない
 */
export function resolveArcEndpointY(params: {
  noteheadY: number;
  stemTipY?: number;
  upward: boolean;
  anchorToStem: boolean;
  hasManualEndpointOffset?: boolean;
}): number {
  const { noteheadY, stemTipY, upward, anchorToStem, hasManualEndpointOffset = false } = params;
  const gap = hasManualEndpointOffset ? ARC_NOTEHEAD_GAP_LEGACY : ARC_NOTEHEAD_GAP;
  const noteheadAnchored = noteheadY + (upward ? -gap : gap);
  if (!anchorToStem || stemTipY === undefined || !Number.isFinite(stemTipY)) {
    return noteheadAnchored;
  }
  const stemAnchored = stemTipY + (upward ? -ARC_STEM_TIP_GAP : ARC_STEM_TIP_GAP);
  // 符幹先端が符頭より内側にある（＝符幹の向きと弧の向きが食い違う）壊れた値を渡されても、
  // 端点が符頭より内側へ入り込まないようにする。上向きなら「より上」を採る。
  return upward ? Math.min(stemAnchored, noteheadAnchored) : Math.max(stemAnchored, noteheadAnchored);
}

/**
 * スラーが避ける高さ（obstacleY）を、符頭の高さと符幹先端の高さから決める。
 *
 * 符幹先端を混ぜるのは、多声部で弧が符幹側を通るときに
 * 「符頭は避けたが符幹・ビームは貫通する」状態になるのを防ぐため（Issue #296）。
 * 単声部では `stemTipYs` に何も入れずに呼ぶので、従来と同じ値になる。
 *
 * @returns 避けるべき高さ。候補が1つも無ければ undefined（呼び出し側が端点から決める）
 */
export function resolveSlurObstacleY(params: {
  upward: boolean;
  noteheadYs: number[];
  stemTipYs?: number[];
}): number | undefined {
  const candidates = [...params.noteheadYs, ...(params.stemTipYs ?? [])].filter(Number.isFinite);
  if (candidates.length === 0) return undefined;
  return params.upward ? Math.min(...candidates) : Math.max(...candidates);
}
