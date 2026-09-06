// src/editor/handlers/noteClick/types.ts
// 符頭クリック（PianoSystemCanvas の 744 行のハンドラ）をモードごとに割って移すときの共通の引数型
// （#695 段6b-4）。設計書 §17 の「文脈＋対象＋ツール＋書き込み口」のうち、対象と書き込み口をここに置く。
// 値はすべて描画 effect のローカルそのもの（束ねても挙動は変わらない）。
import type { MeasureData, NoteEvent } from '../../../types/storage';
import type { InstrumentType } from '../../../audio/SoundSource';
import type { PartConfig } from '../../../components/PianoSystemCanvas';
import type { RefObject } from 'react';
import type { CustomSymbolDef } from '../../../types/storage';
import type { OverlayRectLike } from '../../../utils/symbolOverlayPlacementUtils';
import type { AdjustTarget, OverlayStates, Sel } from '../../types';

/** 描画時に声部へ束縛されたイベント列の要素。全休符プレースホルダーは __isPlaceholder が立つ */
export type ClickableNoteEvent = NoteEvent & { __isPlaceholder?: boolean };

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
}

/** 譜面・選択・再生へ書き込む口（Canvas が持つ関数をそのまま渡す） */
export interface NoteWriter {
  /** 解決済み帰属（hitPi / hitVoice）で j 番目のイベントを書き換える */
  updateHitEvent: (targetJ: number, compute: (targetEv: ClickableNoteEvent) => ClickableNoteEvent | null) => void;
  setSelected: (value: React.SetStateAction<NonNullable<Sel> | null>) => void;
  playNoteEvent: (noteEvent: NoteEvent, instrument?: InstrumentType) => void | Promise<void>;
  /** 解決済み帰属のパートの小節列を updater で書き換える（setScoreFor(hitPi)。段6b-4d で追加） */
  setHitScore: (updater: (prev: MeasureData[]) => MeasureData[]) => void;
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
