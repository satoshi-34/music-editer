// src/editor/types.ts
// 編集状態と描画台帳の**純データ型**（#695 段6b-1）。PianoSystemCanvas に散らばっていた宣言を
// 1 か所に寄せた。コンポーネントの実装（props・state・閉包）に依存しない型だけを置く。
// 描画台帳の塊（RenderCollectors）と props 型（PartConfig）は段6b/6c で扱うため、まだ移していない。
// 各型の中身・コメントは移設前と同一（挙動ゼロ差）。
import type React from 'react';
import type { MutableRefObject } from 'react';
import type { Stave, StaveNote } from 'vexflow';
import type { ClefType } from '../components/clefUtils';
// RenderCollectors（描画台帳の塊）は段6c で LedgerContext の内側へ移すまで PianoSystemCanvas に置く。
// ここでは型だけを借りる（実行時の依存は無い。systemSpans.ts と同じ扱い）
import type { RenderCollectors } from '../components/PianoSystemCanvas';
import type { AdjustableSymbolKind } from '../types/storage';
import type { TextElementKind } from '../utils/textElementUtils';
import type { OverlayRectLike } from '../utils/symbolOverlayPlacementUtils';

// ── 選択 ─────────────────────────────────────────────────
// voiceIndex: 声部2（下声）の音符を選択したときだけ 1 を入れる。
// 未指定（voice0/primary）は既存互換のため 0 扱いにする。
export type Sel = { partIndex: number; measure: number; index: number; keyIndex?: number; voiceIndex?: number } | null;
// 選択中の弧・松葉の型（#244 段1: latestRef と useState で共用するため alias 化）
export type SelectedArcSel = { partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; arcIndex: number } | null;
export type SelectedHairpinSel = { partIndex: number; voiceIndex: number; fromMeasure: number; fromEvent: number; hairpinIndex: number } | null;

// ── 再クリック巡回 ────────────────────────────────────────
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

// ── 文脈（#695 段6b-2）─────────────────────────────────────
// 描画 effect のローカルを「変更する理由が同じもの」ごとに束ねた型。描画関数・ハンドラは
// 平らな十数個の引数ではなく、この束と「対象」（どの小節・どの音符か）を受ける。
// 束の中身はいずれも effect 内で作った値・ref そのもので、束ねること自体は挙動を変えない。

/**
 * 「いま何が選ばれているか」と、その setter。
 * 注意: 値（selected / selectedArc / selectedHairpin）は **effect 開始時のスナップショット**で live ではない。
 * 閉包が捕まえていた値と同一なのでゼロ差だが、live が要る所（latestRef.current.x を読む箇所）は
 * 別引数で latestRef を渡す。ハンドラ移設時に latestRef.current.x → selection.x と置換してはいけない。
 */
export interface SelectionContext {
  selected: Sel;
  selectedArc: SelectedArcSel;
  selectedHairpin: SelectedHairpinSel;
  setSelected: (value: React.SetStateAction<NonNullable<Sel> | null>) => void;
  setSelectedArc: (value: React.SetStateAction<NonNullable<SelectedArcSel> | null>) => void;
  setSelectedHairpin: (value: React.SetStateAction<NonNullable<SelectedHairpinSel> | null>) => void;
}

/** 編集レイヤー（#316/#417）: どのパート・声部が編集対象で、どのパートを強調表示するか */
export interface LayerContext {
  activeLayerPartIndex: number | undefined;
  activeVoiceIndex: number;
  activeLayerHighlightPartIndex: number | null;
}

/**
 * 描画台帳（effect 内で生成し、Pass 3 が埋め、末尾が読む）と、ドラッグ中に読む ref。
 * arcIdentityMap / arcGeomMap / notePositionMapP は collectors の中身と同じ Map を指す
 * （effect が分割代入したローカル名をそのまま束ねている）。
 */
export interface LedgerContext {
  arcIdentityMap: Map<string, ArcIdentityP>;
  arcGeomMap: Map<string, ArcGeom>;
  notePositionMapP: Map<string, NotePositionP>;
  collectors: RenderCollectors;
  dragSessionsRef: MutableRefObject<DragSessions>;
  clickCyclePendingRef: MutableRefObject<PendingClickCycle | null>;
}

/** 今回の描画が作った SVG とその描画ルート（要素は描画のたびに作り直される） */
export interface SvgContext {
  svg: SVGSVGElement;
  svgRoot: SVGGElement;
}

/** 再クリック巡回（#264）の入口 5 つ。createClickCycle の戻り値そのもの */
export interface ClickCycleApi {
  registerClickCycleTarget: (el: Element, target: ClickCycleTarget) => void;
  prepareClickCycle: (selfId: string, clientX: number, clientY: number) => PendingClickCycle | null;
  commitClickCycle: (pending: PendingClickCycle) => void;
  tryClickCycle: (selfId: string, clientX: number, clientY: number) => boolean;
  armClickCycleFor: (selfId: string, clientX: number, clientY: number) => void;
}

// ── 編集ローカル状態（選択・オーバーレイ）の型（#695 段6b-4c-prep で PianoSystemCanvas の関数内から移設。中身は不変）──
// サイズ・位置調整の対象1件。カスタム記号（symbolId で識別）と
// 標準記号（kind で識別。fingering/dynamics など）の両方を同じ形で扱えるようにする（StaffCanvas と同じ考え方）。
export type AdjustTarget =
  | { type: 'custom'; symbolId: string; name: string }
  | { type: 'standard'; kind: AdjustableSymbolKind };

export type OverlayStates = {
  timeSig: {
  measureAbsoluteIndex: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  /** 弱起（アウフタクト＝不完全小節）の設定オーバーレイ（Issue #473） */
  pickup: {
  measureAbsoluteIndex: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  keySig: {
  measureAbsoluteIndex: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  clef: {
  measureAbsoluteIndex: number;
  partIndex: number;
  /**
   * 小節途中のクレフ変更（Issue #424）で「この音から変える」対象にした音符の位置。
   * 音符をクリックしたときだけ入り、小節の背景をクリックしたとき（従来の小節単位の
   * 変更）は undefined。確定処理はこの有無だけで書き込み先を切り替える。
   */
  eventIndex?: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  bpm: {
  measureAbsoluteIndex: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  /** 自由注釈テキスト（Issue #421）。文字・サイズ・位置を1枚のオーバーレイで扱う */
  freeText: {
  measureAbsoluteIndex: number;
  partIndex: number;
  currentText: string;
  currentScalePercent: string;
  currentOffsetX: string;
  currentOffsetY: string;
  /** 書体の id（Issue #432）。既定は DEFAULT_TITLE_FONT_ID */
  currentFontId: string;
  overlayX: number;
  overlayY: number;
  } | null;
  rehearsal: {
  measureAbsoluteIndex: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  text: {
  kind: TextElementKind;
  partIndex: number;
  measureAbsoluteIndex: number;
  eventIndex: number;
  voiceIndex: number;
  currentValue: string;
  overlayX: number;
  overlayY: number;
  } | null;
  symbolResize: {
  partIndex: number;
  measureAbsoluteIndex: number;
  eventIndex: number;
  voiceIndex: number;
  target: AdjustTarget;
  currentValue: string;
  anchor: OverlayRectLike;
  } | null;
  symbolOffset: {
  partIndex: number;
  measureAbsoluteIndex: number;
  eventIndex: number;
  voiceIndex: number;
  target: AdjustTarget;
  currentX: string;
  currentY: string;
  draftX: number;
  draftY: number;
  // 調整対象の記号の実描画範囲（Issue #230。symbolResizeEditState の anchor と同じ意味）
  anchor: OverlayRectLike;
  } | null;
  symbolPicker: {
  partIndex: number;
  measureAbsoluteIndex: number;
  eventIndex: number;
  voiceIndex: number;
  kind: 'resize' | 'offset';
  options: AdjustTarget[];
  overlayX: number;
  overlayY: number;
  } | null;
};
export type OverlayKind = keyof OverlayStates;
export type OverlayUnion = { [K in OverlayKind]: { kind: K; payload: NonNullable<OverlayStates[K]> } }[OverlayKind];
export type SelectionSlot = 'note' | 'arc' | 'hairpin';
export type SelectionPayloads = {
  note: NonNullable<Sel>;
  arc: NonNullable<SelectedArcSel>;
  hairpin: NonNullable<SelectedHairpinSel>;
};
export type SelectionUnion = { [K in SelectionSlot]: { kind: K; payload: SelectionPayloads[K] } }[SelectionSlot];
export type EditorLocalState = { selection: SelectionUnion | null; overlay: OverlayUnion | null };
// value は各 slot/kind ごとに型が違うため action 上は unknown で運び、
// 型安全は同名ラッパー（従来の setter と同じシグネチャ）で担保する
export type EditorLocalAction =
  | { type: 'SELECTION_SET'; slot: SelectionSlot; value: unknown }
  | { type: 'OVERLAY_SET'; kind: OverlayKind; value: unknown }
  // ツール切替: オーバーレイを全種キャンセル（差分表#1）。選択は #238 の既存仕様
  //（ScorePage からの CLEAR 要求）に任せるためここでは触らない
  | { type: 'TOOL_CHANGED' }
  // タブ切替・ツール変更・再生開始の掃除要求（SCORE_SELECTION_CLEAR_EVENT）:
  // 従来の選択解除に加えてオーバーレイも閉じる（差分表#4）
  | { type: 'CLEAR_ALL' }
  // 他の段が選択を取った（SELECTION_CLAIMED_EVENT）: 自段の選択だけ手放す
  | { type: 'SELECTION_CLAIMED_BY_OTHER' };
