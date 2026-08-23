// src/utils/symbolAdjustUtils.test.ts
// 標準記号（運指・強弱など）の配置ごとのサイズ・位置調整ロジックのテスト。
// customSymbolUtils の setCustomSymbolScale/setCustomSymbolOffset と同じ考え方の
// 一般化なので、対応するテストと似た観点（範囲外クランプ・未付与記号への無視）を確認する。

import { describe, it, expect } from 'vitest';
import type { NoteEvent } from '../types/storage';
import {
  getSymbolAdjust,
  listPresentAdjustableSymbolKinds,
  setSymbolAdjustOffset,
  setSymbolAdjustScale,
  setSymbolAdjustScale,
  setSymbolAdjustOffset,
  DEFAULT_SYMBOL_ADJUST,
} from './symbolAdjustUtils';

function baseNote(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return { dur: '4', isRest: false, keys: ['c/4'], ...overrides };
}

describe('listPresentAdjustableSymbolKinds', () => {
  it('休符では音符専用の記号（運指・強弱・アーティキュレーション）を列挙しない', () => {
    expect(listPresentAdjustableSymbolKinds(baseNote({ isRest: true, fingering: '1' }))).toEqual([]);
  });

  it('休符でもテキスト系・オッターバは列挙する（休符にも付けられるため・#398 round4）', () => {
    // 以前は休符を一律で除外していたため、休符に付けたコード記号などの調整が
    // 「小窓は開くのに保存されない」無言の no-op になっていた
    const ev = baseNote({ isRest: true, chordSymbol: 'Am', lyrics: 'ら', tempoMarking: 'Fine', expressionMarking: 'dolce', ottava: '8va' });
    expect(listPresentAdjustableSymbolKinds(ev).sort())
      .toEqual(['chordSymbol', 'expressionMarking', 'lyrics', 'ottava', 'tempoMarking'].sort());
  });

  it('休符に付いたテキスト記号は調整値を保存できる（設定関数側の回帰）', () => {
    const rest = baseNote({ isRest: true, chordSymbol: 'Am' });
    expect(setSymbolAdjustOffset(rest, 'chordSymbol', 4, -8).symbolAdjust?.chordSymbol)
      .toEqual({ offsetX: 4, offsetY: -8 });
    expect(setSymbolAdjustScale(rest, 'chordSymbol', 1.5).symbolAdjust?.chordSymbol?.scale).toBe(1.5);
    // 音符専用の記号は休符では従来どおり no-op（データを汚さない）
    const restWithFingering = baseNote({ isRest: true, fingering: '1' });
    expect(setSymbolAdjustOffset(restWithFingering, 'fingering', 4, -8)).toBe(restWithFingering);
  });

  it('付いている記号だけを列挙する', () => {
    const ev = baseNote({ fingering: '3', dynamics: [{ value: 'f' } as any], chordSymbol: 'Am' });
    expect(listPresentAdjustableSymbolKinds(ev).sort()).toEqual(['chordSymbol', 'dynamics', 'fingering'].sort());
  });

  it('装飾記号は対応対象外なので列挙しない', () => {
    const ev = baseNote({ ornament: 'trill' });
    expect(listPresentAdjustableSymbolKinds(ev)).toEqual([]);
  });

  it('アーティキュレーションは手組みSVG描画のため列挙する', () => {
    const ev = baseNote({ articulations: ['staccato'] });
    expect(listPresentAdjustableSymbolKinds(ev)).toEqual(['articulations']);
  });

  it('休符に付いたアーティキュレーションは列挙しない', () => {
    const ev = baseNote({ isRest: true, articulations: ['fermata'] });
    expect(listPresentAdjustableSymbolKinds(ev)).toEqual([]);
  });

  it('8va/8vb の開始イベントはオッターヴァを列挙する', () => {
    expect(listPresentAdjustableSymbolKinds(baseNote({ ottava: '8va' }))).toEqual(['ottava']);
    expect(listPresentAdjustableSymbolKinds(baseNote({ ottava: '8vb' }))).toEqual(['ottava']);
  });

  it('8va/8vb の終了イベントはオッターヴァを列挙しない（開始側のみ調整対象）', () => {
    expect(listPresentAdjustableSymbolKinds(baseNote({ ottava: '8vaEnd' }))).toEqual([]);
    expect(listPresentAdjustableSymbolKinds(baseNote({ ottava: '8vbEnd' }))).toEqual([]);
  });
});

describe('getSymbolAdjust', () => {
  it('未設定なら既定値（scale=1, offset=0）を返す', () => {
    expect(getSymbolAdjust(baseNote({ fingering: '2' }), 'fingering')).toEqual(DEFAULT_SYMBOL_ADJUST);
  });

  it('設定済みの値を返す', () => {
    const ev = baseNote({ fingering: '2', symbolAdjust: { fingering: { scale: 2, offsetX: 5, offsetY: -5 } } });
    expect(getSymbolAdjust(ev, 'fingering')).toEqual({ scale: 2, offsetX: 5, offsetY: -5 });
  });
});

describe('setSymbolAdjustScale', () => {
  it('記号が付いていない場合は何もせず元のeventを返す', () => {
    const ev = baseNote();
    expect(setSymbolAdjustScale(ev, 'fingering', 2)).toBe(ev);
  });

  it('範囲内の値をそのまま保存する', () => {
    const ev = baseNote({ fingering: '2' });
    const next = setSymbolAdjustScale(ev, 'fingering', 2);
    expect(next.symbolAdjust?.fingering?.scale).toBe(2);
  });

  it('上限(4)を超える値はクランプする', () => {
    const ev = baseNote({ fingering: '2' });
    const next = setSymbolAdjustScale(ev, 'fingering', 100);
    expect(next.symbolAdjust?.fingering?.scale).toBe(4);
  });

  it('下限(0.25)未満の値はクランプする', () => {
    const ev = baseNote({ fingering: '2' });
    const next = setSymbolAdjustScale(ev, 'fingering', 0.01);
    expect(next.symbolAdjust?.fingering?.scale).toBe(0.25);
  });

  it('他の記号種別のsymbolAdjustは保持したまま更新する', () => {
    const ev = baseNote({
      fingering: '2',
      chordSymbol: 'Am',
      symbolAdjust: { chordSymbol: { scale: 1.5 } },
    });
    const next = setSymbolAdjustScale(ev, 'fingering', 2);
    expect(next.symbolAdjust?.chordSymbol?.scale).toBe(1.5);
    expect(next.symbolAdjust?.fingering?.scale).toBe(2);
  });
});

describe('setSymbolAdjustOffset', () => {
  it('記号が付いていない場合は何もせず元のeventを返す', () => {
    const ev = baseNote();
    expect(setSymbolAdjustOffset(ev, 'lyrics', 10, 10)).toBe(ev);
  });

  it('範囲内の値をそのまま保存する', () => {
    const ev = baseNote({ lyrics: 'la' });
    const next = setSymbolAdjustOffset(ev, 'lyrics', 20, -30);
    expect(next.symbolAdjust?.lyrics).toEqual({ offsetX: 20, offsetY: -30 });
  });

  it('範囲外(±100超)の値はクランプする', () => {
    const ev = baseNote({ lyrics: 'la' });
    const next = setSymbolAdjustOffset(ev, 'lyrics', 999, -999);
    expect(next.symbolAdjust?.lyrics).toEqual({ offsetX: 100, offsetY: -100 });
  });
});
