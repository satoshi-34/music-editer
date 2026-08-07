/**
 * 弧（タイ／スラー）の「向き」と「障害物回避のスコープ」を決める純ロジック。
 *
 * 描画コード（PianoSystemCanvas）から切り出してあるのは、
 * 浄書上の決めごと（2声部書法の慣行）を座標計算と混ぜないためと、
 * テストで機械的に固定できるようにするため（Issue #192・設計メモ
 * `.claude/specs/voice2-arc-support/design.md` §5・§6）。
 */

/**
 * 2声部が共存する小節での弧の既定の向きを決める。
 *
 * 標準的な浄書では、2声部書法の弧は音高ではなく声部で向きが決まる
 * （声部1＝上声は上向き、声部2＝下声は下向き）。符幹の向きを声部で固定する
 * `resolveVoiceStemDirections` とまったく同じ発想で、こうしておくと
 * 「どちらの声部に属する弧か」が形だけで読み取れる。
 *
 * - 声部が1つしか無い小節・声部トグルの無い譜種（単旋律・四重奏・編成譜）は
 *   `isMultiVoiceMeasure` が常に false になるので、従来どおり音高から決まる
 *   （＝既存譜面の見た目を変えない）。
 * - `flipDirection`（ユーザーの手動反転）は最後に適用する。既定値がどちらでも
 *   「反転させた」という意思が最優先で効く、という従来の関係を保つため。
 *
 * @param isMultiVoiceMeasure 弧の**始点がある小節**に声部が2本あるか。
 *   複数小節にまたがる弧でも始点の小節だけで判定する（途中で向きが変わると
 *   段またぎの2セグメントが食い違ってしまうため）。
 * @param voiceIndex 弧が載っている声部（0 = 声部1＝上声）
 * @param pitchBasedUpward 従来どおり音高から決めた向き（タイなら始点の五線位置、
 *   スラーなら区間内の音符の平均から求めた値）
 * @param flipDirection ユーザーが手動で反転させたか
 */
export function resolveArcUpward(params: {
  isMultiVoiceMeasure: boolean;
  voiceIndex: number;
  pitchBasedUpward: boolean;
  flipDirection?: boolean;
}): boolean {
  const base = params.isMultiVoiceMeasure
    ? params.voiceIndex === 0
    : params.pitchBasedUpward;
  return params.flipDirection ? !base : base;
}

/**
 * スラーが避ける障害物（途中の音符）をどこまで集めるか。
 * - `own-voice`: 弧と同じ声部の音符だけを避ける（既定・Issue #192 で確定した正式仕様）
 * - `all-voices`: 同じパートの全声部の音符を避ける（将来方針を変えたくなったとき用）
 */
export type SlurObstacleScope = 'own-voice' | 'all-voices';

export const DEFAULT_SLUR_OBSTACLE_SCOPE: SlurObstacleScope = 'own-voice';

/**
 * ある音符を、そのスラーの障害物として数えるかどうかを判定する。
 *
 * 自声部限定を既定にしている理由（浄書慣行）: スラーは声部に属する記号であり、
 * 上声のスラーは上声の音符に沿って引かれる。他声部の音符まで避けようとすると
 * 弧が不自然に大きく膨らみ、かえって相手の声部の符幹やスラーとぶつかる。
 * 声部2の下向きスラーが声部1の低い音符と交差する構図はあり得るが、
 * その場合はユーザーが曲率ドラッグ（cpDyOffset）で逃がせる。
 *
 * 同じパート内で呼ぶ前提（パートが違う音符はそもそも別の五線なので呼び出し側で弾く）。
 */
export function isSlurObstacleNote(params: {
  arcVoiceIndex: number;
  noteVoiceIndex: number;
  scope?: SlurObstacleScope;
}): boolean {
  const scope = params.scope ?? DEFAULT_SLUR_OBSTACLE_SCOPE;
  if (scope === 'all-voices') return true;
  return params.arcVoiceIndex === params.noteVoiceIndex;
}
