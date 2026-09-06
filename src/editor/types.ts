// src/editor/types.ts
// 編集状態と描画台帳の**純データ型**（#695 段6b-1）。PianoSystemCanvas に散らばっていた宣言を
// 1 か所に寄せた。コンポーネントの実装（props・state・閉包）に依存しない型だけを置く。
// 描画台帳の塊（RenderCollectors）と props 型（PartConfig）は段6b/6c で扱うため、まだ移していない。
// 各型の中身・コメントは移設前と同一（挙動ゼロ差）。
import type { Stave, StaveNote } from 'vexflow';
import type { ClefType } from '../components/clefUtils';

// ── 選択 ─────────────────────────────────────────────────
// voiceIndex: 声部2（下声）の音符を選択したときだけ 1 を入れる。
// 未指定（voice0/primary）は既存互換のため 0 扱いにする。
export type Sel = { partIndex: number; measure: number; index: number; keyIndex?: number; voiceIndex?: number } | null;
// 選択中の弧・松葉の型（#244 段1: latestRef と useState で共用するため alias 化）
export type SelectedArcSel = { partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number } | null;
export type SelectedHairpinSel = { partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number } | null;

// ── 再クリック巡回（Issue #264） ─────────────────────────────
// 再クリック巡回（Issue #264）の候補1件ぶん。描画時に当たり判定要素へ紐づけて台帳に積む。
export type ClickCycleTarget = {
  /**
   * 再描画をまたいでも同じ値になる論理ID。
   * 例: 音符 `note:p0:m3:v0:e2` / 弧 `arc:p0v0m3e2a0` / 松葉 `hairpin:p0v0m3e2h0`
   */
  id: string;
  /** その座標で本当に選択対象になるか（符頭から外れた位置では音符は候補にしない） */
  canActivate: (clientX: number, clientY: number) => boolean;
  /** 巡回で選ばれたときに実行する「選択だけ」の処理（音符を増やす等の編集はしない） */
  activate: (clientX: number, clientY: number) => void;
};

/** 巡回の「預けた計画」（mousedown で作り、mouseup で実行する）。clickCyclePendingRef の中身 */
export type PendingClickCycle = { clientX: number; clientY: number; consumed: string[]; activate: () => void };

// ── 弧（タイ／スラー）の台帳 ──────────────────────────────
/**
 * 弧（タイ／スラー）1本ぶんの形状パラメータ。
 * 描画時に arcGeomMap へ積んでおき、ドラッグ中の再計算（computeArcGeometry の引数）に使う。
 */
export type ArcGeom = {
  x1: number; y1: number; x2: number; y2: number;
  upward: boolean; kind: 'tie' | 'slur'; stemDir: number; obstacleY?: number;
  minNoteY?: number; maxNoteY?: number;
  startDx: number; startDy: number; endDx: number; endDy: number;
  cpDyOffset: number;
  // 頂点の左右位置（スパンに対する比率、正 = 右）。ドラッグ中の再計算で使う
  apexXRatio: number;
};
/** 音符の描画位置台帳: 弧・松葉の端点解決に使う（キーは pXvXmXeX 形式） */
export type NotePositionP={note:StaveNote;stave:Stave;clef:ClefType;keys:string[];partIndex:number;measureIndex:number;voiceIndex:number;eventIndex:number};
/** 弧の同定情報（どのパート・声部・イベントの何本目の弧か）。arcKey 文字列の解析を廃止した台帳 */
export type ArcIdentityP={partIndex:number;voiceIndex:number;fromMeasure:number;fromEvent:number;arcIndex:number};

// ── ドラッグセッション ────────────────────────────────────
/** ドラッグ中の各セッション（#695 段6a でモジュールスコープへ移動。中身は不変） */
export type DragSessions = {
  arcCp: {
  partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
  startSvgY: number; originalOffset: number;
  baseArcKey: string;   // arcGeomMap 検索用ベースキー（suffix なし）
  flipApplied: boolean; // ドラッグ中に方向反転が起きたか
  segment: '' | '-1' | '-2'; // ドラッグ対象セグメント（'' = 非段またぎ）
  apex: boolean;        // 頂点ハンドルからのドラッグか
  startSvgX: number; originalRatio: number;
  origin: { svgY: number; offset: number; svgX: number; ratio: number };
  moved: boolean;       // 実際に形が変わったか（クリックしただけなら false）
  } | null;
  arcEp: {
    partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number;
    endpoint: 'start' | 'end';
    segment: '' | '-1' | '-2';
    baseArcKey: string;
    startSvgX: number; startSvgY: number;
    originalDx: number; originalDy: number;
    moved: boolean;       // 実際に動かしたか（クリックしただけなら false）
  } | null;
  arcMoved: boolean;
  tieStart: {
    partIndex: number; voiceIndex: number; absoluteIndex: number; noteIndex: number;
    startKey: string; // ドラッグを開始した符頭の key
    noteX: number; noteY: number; stemDir: number;
  } | null;
  measureAnchor: number | null;
  /** 拍範囲スライス選択（#333 段2）のドラッグ開始点。null なら小節丸ごとドラッグ */
  beatAnchor: { measure: number; beat: number } | null;
  measureMoved: boolean;
  /**
   * 記号のドラッグ移動（Issue #522）。位置調整（✥）オーバーレイを開いている記号を
   * つかんでいる間だけ入る。動かした値の反映は矢印キーとまったく同じ「下書き」経路
   * （applySymbolOffsetDraft）に任せるので、ここにはドラッグの起点だけを持つ。
   */
  symbolOffset: {
    /** つかんだ瞬間の SVG 内部座標（オフセット値と同じ単位系） */
    startSvgX: number; startSvgY: number;
    /** つかんだ瞬間の画面座標（しきい値の判定用。SVG 内部座標だと拡大率で遊びが変わる） */
    startClientX: number; startClientY: number;
    /**
     * つかんだ瞬間のオフセット値。移動量は毎回「この値＋総移動量」で計算する。
     * 1回ごとの差分を足し込む方式にすると、上下限で丸められたぶんが失われて
     * 戻すときに指と記号がずれていく（クランプの累積ずれ）ため。
     */
    baseX: number; baseY: number;
    /** しきい値を超えて「ドラッグ」になったか（超えるまではただのクリック扱い） */
    moved: boolean;
    /** つかんだポインタ列（タッチ対応・多点の混線防止。round1 P2） */
    pointerId: number;
    /**
     * 未選択の記号を直接つかんだとき（Issue #553）に、しきい値を超えた時点で
     * 「その記号を選ぶ（＝✥ オーバーレイを開く）」ために呼ぶ処理。
     * すでに調整中の記号をつかんだ場合は null（開き直す必要がない）。
     *
     * ここで初めて開くのは、押した瞬間に開いてしまうと「選ぶつもりの1クリック」でも
     * オーバーレイが2回開き直すことになり、3px 未満は従来どおりの click に任せる
     * という仕様（#553 受入2）が守れないため。
     *
     * 戻り値 false は「開けなかった」（例: 編集 UI の無い3声以降の記号）。
     * その場合ドラッグは成立させず中止する。
     */
    beginAdjust: ((clientX: number, clientY: number) => boolean) | null;
  } | null;
  /**
   * 直前のドラッグで記号を動かしたか。ドラッグの終わりに必ず来る click を
   * 1回だけ読み飛ばすために使う（弧の arcMoved とまったく同じ役割）。
   */
  symbolOffsetMoved: boolean;
};

