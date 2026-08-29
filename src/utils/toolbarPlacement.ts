// src/utils/toolbarPlacement.ts
// ツールバー（パレット）の配置（上＝横並び / 左＝縦並び）の決め方（Issue #483）。
//
// なぜ純関数として切り出すのか:
// 「保存値の読み書き」「狭い画面では上へ戻す」「幅の丸め」は、ScorePage の中に
// 埋め込むとブラウザを立ち上げないと確かめられない。ここに出しておけば
// 単体テストで仕様を固定できる（--toolbar-h の丸めを分けた toolbarHeight.ts と同じ方針）。

/** ツールバーの配置。`top` が従来（画面上部の横並び）で既定。 */
export type ToolbarPlacement = 'top' | 'left';

/** 未設定・壊れた保存値のときに使う既定値（＝従来の見た目） */
export const DEFAULT_TOOLBAR_PLACEMENT: ToolbarPlacement = 'top';

/** 記憶用の localStorage キー。他の表示設定と同じ `score-` 接頭辞にそろえる。 */
export const TOOLBAR_PLACEMENT_KEY = 'score-toolbar-placement';

/**
 * 左（縦）配置を許す最小のウィンドウ幅(px)。
 * これより狭い画面では、選んでいても上（横）配置へ戻す。
 * 縦に長い画面（スマホ）では高さより横幅のほうが貴重で、左に帯を置くと
 * 譜面の幅がさらに削られてしまうため（Issue #483 の実装メモの判断）。
 * 値は App.css のモバイル向けブレークポイント（768px）と合わせてある。
 */
export const TOOLBAR_LEFT_MIN_VIEWPORT_WIDTH_PX = 768;

/** 左配置のときの幅の下限。実測できない環境（jsdom など）でもこの値になる */
export const TOOLBAR_WIDTH_MIN_PX = 120;
/** 折り畳み中の幅の下限（トグル1個ぶんの細い帯しか残らないので低い） */
export const TOOLBAR_WIDTH_MIN_COLLAPSED_PX = 32;
/** 幅の上限。暴走した実測値で譜面が画面外へ押し出されるのを防ぐ安全弁 */
export const TOOLBAR_WIDTH_MAX_PX = 480;

/** 切り替えチップの表示内容（レイアウトタブに並べる順） */
export const TOOLBAR_PLACEMENT_OPTIONS: ReadonlyArray<{
  value: ToolbarPlacement;
  label: string;
  description: string;
}> = [
  {
    value: 'top',
    label: '上（横）',
    description: 'ツールバーを画面の上に横並びで置きます（既定）',
  },
  {
    value: 'left',
    label: '左（縦）',
    description:
      'ツールバーを画面の左に縦並びで置きます。譜面を縦に長く見たいときに向きます（画面幅が狭いときは自動で上に戻ります）',
  },
];

/** 受け取った値が ToolbarPlacement のどちらかか（未知の文字列を弾く） */
export function isToolbarPlacement(value: unknown): value is ToolbarPlacement {
  return value === 'top' || value === 'left';
}

/**
 * 記憶している配置を読む。localStorage が使えない環境（プライベートブラウジング等）でも
 * 例外を投げずに既定値を返す（設定の仕組みのせいでアプリが起動しない、を防ぐ）。
 */
export function loadStoredToolbarPlacement(): ToolbarPlacement {
  try {
    const raw = localStorage.getItem(TOOLBAR_PLACEMENT_KEY);
    return isToolbarPlacement(raw) ? raw : DEFAULT_TOOLBAR_PLACEMENT;
  } catch {
    return DEFAULT_TOOLBAR_PLACEMENT;
  }
}

/** 配置を記憶する。保存に失敗しても致命的ではないので握りつぶす。 */
export function saveToolbarPlacement(placement: ToolbarPlacement): void {
  try {
    localStorage.setItem(TOOLBAR_PLACEMENT_KEY, placement);
  } catch {
    // quota超過・プライベートブラウジング等。今回の表示だけ切り替わっていればよい
  }
}

/**
 * 「ユーザーが選んだ配置」と「今のウィンドウ幅」から、実際に適用する配置を決める。
 *
 * 左を選んでいても狭い画面では上へ戻す（ユーザーの選択自体は消さないので、
 * 画面を広げれば左配置に戻る）。幅が測れない場合は安全側の上配置にする。
 */
export function resolveEffectiveToolbarPlacement(input: {
  placement: ToolbarPlacement;
  viewportWidth: number;
}): ToolbarPlacement {
  if (input.placement !== 'left') return 'top';
  if (!Number.isFinite(input.viewportWidth)) return 'top';
  return input.viewportWidth >= TOOLBAR_LEFT_MIN_VIEWPORT_WIDTH_PX ? 'left' : 'top';
}

/** 左配置のツールバー幅の実測値を、妥当な範囲へ丸める（resolveToolbarHeight の幅版） */
export function resolveToolbarWidth(
  measuredWidthPx: number,
  { collapsed }: { collapsed: boolean }
): number {
  // 実測が数値にならない環境（jsdom など）では下限を返す。NaN をそのまま
  // CSS変数へ入れると `--toolbar-w: NaNpx` になり本文の余白が壊れる
  const min = collapsed ? TOOLBAR_WIDTH_MIN_COLLAPSED_PX : TOOLBAR_WIDTH_MIN_PX;
  if (!Number.isFinite(measuredWidthPx)) return min;
  return Math.min(TOOLBAR_WIDTH_MAX_PX, Math.max(min, measuredWidthPx));
}

/** リセットメニュー等の fixed ポップアップの最大高さ(px)。App.css の max-height と同じ値 */
export const DROPDOWN_MENU_MAX_HEIGHT_PX = 420;

/**
 * ボタン直下へ開く fixed メニューの top を、画面内へ収まるようにクランプする（#483 round1 P1）。
 * 左（縦）配置ではツールバー末尾のボタンが画面下部に来るため、常に下向きへ開くと
 * メニューの後半が画面外へ出て操作できなくなる。メニューの最大高さぶんの余地が
 * なければ上へずらす（最低 8px は残す）。
 */
export function clampDropdownMenuTop(input: {
  anchorBottom: number;
  viewportHeight: number;
  menuMaxHeightPx?: number;
}): number {
  const menuMax = Math.min(
    input.menuMaxHeightPx ?? DROPDOWN_MENU_MAX_HEIGHT_PX,
    input.viewportHeight * 0.7,
  );
  return Math.max(8, Math.min(input.anchorBottom + 6, input.viewportHeight - menuMax - 8));
}
