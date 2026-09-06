// src/editor/handlers/noteClick/types.ts
// 符頭クリック（PianoSystemCanvas の 744 行のハンドラ）をモードごとに割って移すときの共通の引数型
// （#695 段6b-4）。設計書 §17 の「文脈＋対象＋ツール＋書き込み口」のうち、対象（幾何を含む）・読む口・書き込み口をここに置く。
// 値はすべて描画 effect のローカルそのもの（束ねても挙動は変わらない）。
import type { MeasureData, NoteEvent } from '../../../types/storage';
import type { InstrumentType } from '../../../audio/SoundSource';
import type { PartConfig } from '../../../components/PianoSystemCanvas';
import type { RefObject } from 'react';
import type { CustomSymbolDef } from '../../../types/storage';
import type { OverlayRectLike } from '../../../utils/symbolOverlayPlacementUtils';
import type { AdjustTarget, OverlayStates, Sel } from '../../types';
import type { Stave } from 'vexflow';
import type { ClefType } from '../../../components/clefUtils';
import type { KeySignature } from '../../../utils/noteKeyUtils';

/** 描画時に声部へ束縛されたイベント列の要素。全休符プレースホルダーは __isPlaceholder が立つ */
export type ClickableNoteEvent = NoteEvent & { __isPlaceholder?: boolean };

/**
 * 符頭クリックが読む幾何（段6b-4e で追加）。当たり判定まわりの Canvas ローカルを束ねたもの:
 * buildNoteHitGeometry（editor/hitResolution の resolveNoteHitGeometry）の戻り値（chordTopY / chordBotY / noteK2l /
 * snapLineForKeySelect / resolveSelectableKeyIndexAt）、帯の五線と行 ⇄ 鍵の変換（stave / l2k / k2l）、クリック点（lx / ly）、
 * リスナ内で求めた和音ゾーン判定（isOnNote）と休符アンカー（restBodyCenterX）。値は Canvas のローカルそのもの。
 */
export interface NoteClickGeometry {
  /** クリック点（SVG group 座標。clientToGroup の戻り値） */
  lx: number;
  ly: number;
  /** 符頭の実描画X範囲 ± CHORD_HIT_PAD かつ五線±3加線の固定Y範囲内＝和音追加ゾーン */
  isOnNote: boolean;
  /** 五線±3加線の固定Y範囲（この外側は「選択だけ」の拡張領域。#218 / #246） */
  chordTopY: number;
  chordBotY: number;
  /** 休符の描画アンカーX（anchors[j]）。休符の bbox は横に広いので、この中心 ± REST_BODY_HIT_HALF_WIDTH で本体クリックを決める */
  restBodyCenterX: number;
  /** 帯のパートの五線（snapLine に渡す） */
  stave: Stave;
  /** 帯のクレフでの行 ⇄ 鍵の変換 */
  l2k: (line: number) => string;
  k2l: (key: string) => number;
  /** 段またぎを解決した「実際に載る五線」のクレフでの keyToLine（#310。臨時記号の付け先の引き直しに使う） */
  noteK2l: (key: string) => number;
  /** 符頭選択用の行スナップと、クリック位置が指す構成音の位置（判定式は resolveNoteHitGeometry に集約。ホバー・巡回と共用） */
  snapLineForKeySelect: (y: number) => number;
  resolveSelectableKeyIndexAt: (lx: number, ly: number) => number;
}

/** どの符頭を押したか（帯のパート・小節・イベント位置と、帰属を解決した書き込み先） */
export interface NoteTarget {
  /** クリックした帯のパート */
  pi: number;
  /** 楽章全体での小節番号 */
  absI: number;
  /** アクティブ声部のイベント列での位置 */
  j: number;
  /** resolveHitAttribution で解決した書き込み先のパート・声部 */
  hitPi: number;
  hitVoice: number;
  /** アクティブ声部のイベント列（描画時のスナップショット） */
  activeEvs: ClickableNoteEvent[];
  /** 押したのが休符（全休符プレースホルダー含む）か */
  clickedIsRest: boolean;
  /** 帯のパート設定（再生楽器などを読む） */
  part: PartConfig;
  /** 全パートの設定（段またぎ表示の向きは編成＝パート数で決まる。段6b-4d で追加） */
  parts: PartConfig[];
  /** クリックの画面座標（オーバーレイの出現位置・記号の位置引き当ての逃げ道に使う。段6b-4c で追加） */
  clientX: number;
  clientY: number;
  /** システム内の小節位置（0 が行頭。調号領域の判定は行頭だけ。段6b-4e で追加） */
  i: number;
  /** この小節で有効なクレフ（休符の既定 key・補完に使う。段6b-4e で追加） */
  clefHere: ClefType;
  /** このパート・小節で有効な調号（移調楽器のずれを含む。挿入・和音追加の鍵の綴りに使う。段6b-4e で追加） */
  partKeyForAccidental: KeySignature;
  /** 1 段目の調号の当たり範囲（行頭の休符クリックを調号変更へ流す判定。段6b-4e で追加） */
  firstStaveKeySignatureHitBounds: { left: number; right: number };
  /** 再クリック巡回（#264）でこの符頭を指す id（noteCycleId。段6b-4e で追加） */
  cycleId: string;
  /** 当たり判定の幾何とクリック点（段6b-4e で追加） */
  geometry: NoteClickGeometry;
}

/**
 * 読む口（段6b-4e）: 譜面の最新ミラー・小節容量・設定（6b-4f で休符置換の関数 2 つは editor/durationTools へ移り、直接 import する）。
 * 譜面を書く NoteWriter と分けるのは、署名から「読むだけの依存」と「書く依存」を区別できるようにするため。
 * 値はいずれも Canvas の ref・関数・props そのもの。
 */
export interface NoteReader {
  /** 保存データのミラー（毎レンダーで同期）。当たり判定は描画時点の図形なので、書く前にここで引き直す */
  partsScoreRef: { current: MeasureData[][] };
  /** 小節の容量（拍）。休符補完（fillPriorMeasureRests）に渡す */
  capacityBeatsAt: (absoluteMeasureIndex: number) => number;
  /** 臨時記号を付けたあとに確認音を鳴らすか（props。既定 true） */
  previewAccidentalOnApply: boolean;
}

/** 譜面・選択・再生へ書き込む口（Canvas が持つ関数をそのまま渡す） */
export interface NoteWriter {
  /** 解決済み帰属（hitPi / hitVoice）で j 番目のイベントを書き換える */
  updateHitEvent: (targetJ: number, compute: (targetEv: ClickableNoteEvent) => ClickableNoteEvent | null) => void;
  setSelected: (value: React.SetStateAction<NonNullable<Sel> | null>) => void;
  playNoteEvent: (noteEvent: NoteEvent, instrument?: InstrumentType) => void | Promise<void>;
  /** 解決済み帰属のパートの小節列を updater で書き換える（setScoreFor(hitPi)。段6b-4d で追加） */
  setHitScore: (updater: (prev: MeasureData[]) => MeasureData[]) => void;
  /** クリック位置へ音符・休符を隣接挿入する（Canvas の doInsert。段6b-4e で追加） */
  doInsert: (lx: number, ly: number, sourceBandPi?: number) => void;
  /** 調号領域のクリックで調号を変える（props。段6b-4e で追加） */
  onKeySignatureChange?: (keySignature: KeySignature, partIndex?: number) => void;
}

/**
 * 「UI を開く」書き込み口（段6b-4c）。譜面を書く NoteWriter と分けるのは、モード関数の署名から
 * 「譜面を変えるのか、オーバーレイを開くだけなのか」が読めるようにするため。
 * 値はいずれも Canvas の関数・ref・props そのもの。
 */
export interface NoteUiWriter {
  setSymbolResizeEditState: (value: React.SetStateAction<OverlayStates['symbolResize']>) => void;
  setSymbolOffsetEditState: (value: React.SetStateAction<OverlayStates['symbolOffset']>) => void;
  setSymbolAdjustPickerState: (value: React.SetStateAction<OverlayStates['symbolPicker']>) => void;
  /** テキスト要素（歌詞・運指・コード記号など）の入力オーバーレイを開く（段6b-4d で追加） */
  setTextEditState: (value: React.SetStateAction<OverlayStates['text']>) => void;
  /** 対象が 1 つのときに選択リストを挟まず調整オーバーレイを開く（Canvas の関数） */
  openSymbolAdjustEditor: (
    kind: 'resize' | 'offset', partIndex: number, measureAbsoluteIndex: number, eventIndex: number,
    voiceIndex: number, target: AdjustTarget, event: ClickableNoteEvent, anchor: OverlayRectLike,
  ) => void;
  /** 対象記号の実描画範囲を DOM から探す（見つからなければ null） */
  findSymbolAnchorRect: (partIndex: number, measureAbsoluteIndex: number, eventIndex: number, target: AdjustTarget) => OverlayRectLike | null;
  /** クリック点を「大きさ 0 の対象」として扱う逃げ道 */
  anchorFromClientPoint: (clientX: number, clientY: number) => OverlayRectLike;
  /** オーバーレイの座標系の原点になるコンテナ */
  containerRef: RefObject<HTMLDivElement | null>;
  /** カスタム記号の定義（id → 名前の解決に使う） */
  customSymbolDefs: CustomSymbolDef[];
}
