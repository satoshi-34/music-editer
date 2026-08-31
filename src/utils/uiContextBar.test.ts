// src/utils/uiContextBar.test.ts
// Issue #405（段2）: A1 文脈バーが「いまの状態」をどんな言葉にするかを固定する。
// ScorePage 全体を描かなくても中身を確かめられるよう、純粋関数だけを対象にする。

import { describe, expect, it } from 'vitest';
import { buildContextBarSegments, describeTool } from './uiContextBar';
import type { Tool } from '../components/Palette';

describe('buildContextBarSegments', () => {
  it('ピアノ譜では レイヤー / タブ / ツール の3つを出す（Issue 本文の例と同じ並び）', () => {
    const segments = buildContextBarSegments({
      scoreType: 'piano',
      activeLayerPart: 0,
      activeVoice: 0,
      activeToolbarTab: 'symbols',
      tool: { mode: 'dynamic', dynamic: 'pp' },
    });
    expect(segments.map(s => s.key)).toEqual(['layer', 'tab', 'tool']);
    expect(segments.map(s => s.value)).toEqual(['右手・声部1', '演奏記号', 'pp']);
    // 見出し語（何の情報かを言葉にしたもの）も一緒に出す
    expect(segments.map(s => s.caption)).toEqual(['レイヤー', 'タブ', 'ツール']);
  });

  it('レイヤーは手と声部の組み合わせで変わる', () => {
    const layerOf = (activeLayerPart: number, activeVoice: number) =>
      buildContextBarSegments({
        scoreType: 'piano',
        activeLayerPart,
        activeVoice,
        activeToolbarTab: 'notes',
        tool: { duration: '4' },
      })[0].value;
    expect(layerOf(0, 1)).toBe('右手・声部2');
    expect(layerOf(1, 0)).toBe('左手・声部1');
    expect(layerOf(1, 1)).toBe('左手・声部2');
  });

  it.each(['single', 'quartet', 'ensemble'] as const)(
    '%s ではレイヤーの区画を出さない（手×声部の選択が無い譜種なので）',
    (scoreType) => {
      const segments = buildContextBarSegments({
        scoreType,
        activeLayerPart: 0,
        activeVoice: 0,
        activeToolbarTab: 'layout',
        tool: { duration: '2', isRest: true },
      });
      expect(segments.map(s => s.key)).toEqual(['tab', 'tool']);
      expect(segments.map(s => s.value)).toEqual(['レイアウト', '2分休符']);
    }
  );

  it('カスタム記号ツールでは記号の名前を出す', () => {
    const segments = buildContextBarSegments({
      scoreType: 'single',
      activeLayerPart: 0,
      activeVoice: 0,
      activeToolbarTab: 'symbols',
      tool: { mode: 'customSymbol', symbolId: 'sym-1' },
      customSymbolNames: { 'sym-1': 'ばね' },
    });
    expect(segments[1].value).toBe('カスタム記号「ばね」');
  });
});

describe('describeTool', () => {
  it.each([
    [{ duration: '4' }, '4分音符'],
    [{ duration: '4', isRest: false }, '4分音符'],
    [{ duration: '8', isRest: true }, '8分休符'],
    [{ duration: '1' }, '全音符'],
    [{ duration: '2', dots: 1 }, '付点2分音符'],
    [{ duration: '16', isRest: true, dots: 1 }, '付点16分休符'],
    [{ duration: '8', tuplet: { numNotes: 3, notesOccupied: 2 } }, '3連符（8分音符）'],
    // 入力時に付ける臨時記号（Issue #470）。ONになっていることが一番気づきにくいので文脈バーにも出す
    [{ duration: '4', accidental: 'sharp' }, '♯付き4分音符'],
    [{ duration: '8', dots: 1, accidental: 'flat' }, '♭付き付点8分音符'],
    [{ duration: '8', tuplet: { numNotes: 3, notesOccupied: 2 }, accidental: 'natural' }, '♮付き3連符（8分音符）'],
  ] as Array<[Tool, string]>)('音符ツール %o は「%s」', (tool, expected) => {
    expect(describeTool(tool)).toBe(expected);
  });

  it.each([
    [{ mode: 'select' }, '小節選択'],
    [{ mode: 'tie' }, 'タイ'],
    [{ mode: 'accidental', accidental: 'sharp' }, 'シャープ'],
    [{ mode: 'repeat', repeat: 'end' }, '終了リピート'],
    [{ mode: 'ending', ending: 2 }, '2番括弧'],
    [{ mode: 'dynamic', dynamic: 'mf' }, 'mf'],
    [{ mode: 'dynamic', dynamic: 'cresc' }, 'cresc.'],
    [{ mode: 'articulation', articulation: 'staccato' }, 'スタッカート'],
    [{ mode: 'ornament', ornamentType: 'trill' }, 'トリル'],
    [{ mode: 'textElement', textKind: 'lyrics' }, '歌詞'],
    [{ mode: 'measureKeySig' }, '途中調号変更'],
    [{ mode: 'graceNote' }, '前打音'],
    [{ mode: 'pedal', pedalType: 'down' }, 'ペダル（Ped）'],
    [{ mode: 'hairpin', hairpinType: 'dim' }, '松葉（デクレッシェンド＞）'],
    [{ mode: 'ottava', ottavaType: '8vaEnd' }, '8va の終わり'],
    [{ mode: 'crossStaffToggle' }, '段またぎ表示の切替'],
    [{ mode: 'symbolAdjustOffset' }, '記号の位置調整'],
  ] as Array<[Tool, string]>)('モード付きツール %o は「%s」', (tool, expected) => {
    expect(describeTool(tool)).toBe(expected);
  });

  it('名前の分からないカスタム記号は総称で出す（空欄にしない）', () => {
    expect(describeTool({ mode: 'customSymbol', symbolId: 'unknown' })).toBe('カスタム記号');
    expect(describeTool({ mode: 'customSymbolResize', symbolId: 'x' }, { x: '矢印' }))
      .toBe('カスタム記号「矢印」のサイズ変更');
  });
});
