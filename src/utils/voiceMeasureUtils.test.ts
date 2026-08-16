import { describe, expect, it } from 'vitest';

import type { MeasureData, NoteEvent, PartData } from '../types/storage';
import {
  collapseEmptyTrailingVoices,
  computeVoiceDisplayPadding,
  createEmptyMeasures,
  flattenMeasureForPlayback,
  getDurationBeats,
  getEventDurationBeats,
  getMeasureDurationBeats,
  getMeasureVoices,
  getVoiceEvents,
  normalizeEmptyVoicesInParts,
  resolveVoiceStemDirections,
  syncPrimaryVoiceFromEvents,
  withVoiceEventsUpdated,
} from './voiceMeasureUtils';

describe('voiceMeasureUtils', () => {
  describe('createEmptyMeasures（空の段プレースホルダー用）', () => {
    it('指定した数ぶんの空小節（events: []）を作る', () => {
      const measures = createEmptyMeasures(3);
      expect(measures).toHaveLength(3);
      expect(measures.every((m) => m.events.length === 0)).toBe(true);
    });

    it('0個を指定すると空配列になる', () => {
      expect(createEmptyMeasures(0)).toEqual([]);
    });

    it('各要素は別々の配列参照を持つ（1つを書き換えても他へ影響しない）', () => {
      const measures = createEmptyMeasures(2);
      measures[0].events.push({ dur: '4', isRest: false, keys: ['c/4'] });
      expect(measures[1].events).toHaveLength(0);
    });
  });

  describe('付点による拍数計算', () => {
    it('付点1個(dots:1)は音価の1.5倍になる', () => {
      expect(getDurationBeats('4', 1)).toBeCloseTo(1.5);
      expect(getDurationBeats('8', 1)).toBeCloseTo(0.75);
    });

    it('複付点(dots:2)は音価の1.75倍になる', () => {
      expect(getDurationBeats('4', 2)).toBeCloseTo(1.75);
      expect(getDurationBeats('2', 2)).toBeCloseTo(3.5);
    });

    it('dots未指定は付点なしの拍数のまま', () => {
      expect(getDurationBeats('4')).toBe(1);
    });

    it('getEventDurationBeats は NoteEvent.dots を反映する', () => {
      expect(getEventDurationBeats({ dur: '4', isRest: false, keys: ['c/4'], dots: 1 })).toBeCloseTo(1.5);
      expect(getEventDurationBeats({ dur: '8', isRest: true, keys: [], dots: 2 })).toBeCloseTo(0.875);
    });
  });

  describe('連符（tuplet）による拍数計算', () => {
    it('3連符の8分音符1つは通常の8分音符の2/3拍になる', () => {
      const event = {
        dur: '8' as const, isRest: false, keys: ['c/4'],
        tuplet: { id: 't1', numNotes: 3, notesOccupied: 2 },
      };
      // 通常の8分音符は0.5拍。3連符は 0.5 * (2/3) = 1/3拍
      expect(getEventDurationBeats(event)).toBeCloseTo(1 / 3, 6);
    });

    it('3連符3つ分の合計は通常の8分音符2つ分（=1拍）と等しい', () => {
      const tuplet = { id: 't1', numNotes: 3, notesOccupied: 2 };
      const events = [
        { dur: '8' as const, isRest: false, keys: ['c/4'], tuplet },
        { dur: '8' as const, isRest: true, keys: [], tuplet },
        { dur: '8' as const, isRest: true, keys: [], tuplet },
      ];
      const total = events.reduce((sum, ev) => sum + getEventDurationBeats(ev), 0);
      expect(total).toBeCloseTo(1, 6);
    });

    it('tuplet が無いイベントは通常どおりの拍数のまま', () => {
      expect(getEventDurationBeats({ dur: '8', isRest: false, keys: ['c/4'] })).toBeCloseTo(0.5);
    });
  });

  it('voices が無い小節は events を primary voice として扱う', () => {
    const measure: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['c/4'] }]
    };

    const voices = getMeasureVoices(measure);
    expect(voices).toHaveLength(1);
    expect(voices[0].events).toEqual(measure.events);
  });

  it('複数声部小節は startBeat つきの再生イベントへ平坦化できる', () => {
    const measure: MeasureData = {
      events: [
        { dur: '8', isRest: false, keys: ['e/5'] },
        { dur: '8', isRest: false, keys: ['d#/5'] },
        { dur: '4', isRest: false, keys: ['e/5'] },
      ],
      voices: [
        {
          id: 'voice-1',
          stemDirection: 'up',
          events: [
            { dur: '8', isRest: false, keys: ['e/5'] },
            { dur: '8', isRest: false, keys: ['d#/5'] },
            { dur: '4', isRest: false, keys: ['e/5'] },
          ]
        },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [
            { dur: '4', isRest: true, keys: [] },
            { dur: '8', isRest: false, keys: ['c/4'] },
            { dur: '8', isRest: false, keys: ['e/4'] },
          ]
        }
      ]
    };

    const flattened = flattenMeasureForPlayback(measure);
    expect(flattened.map((event) => event.startBeat)).toEqual([0, 0, 0.5, 1, 1, 1.5]);
    expect(flattened[4].keys).toEqual(['c/4']);
    expect(getMeasureDurationBeats(measure)).toBe(2);
  });

  it('保存前同期で events を voices[0] に写せる', () => {
    const measure: MeasureData = {
      events: [{ dur: '4', isRest: false, keys: ['g/4'] }],
      voices: [
        {
          id: 'voice-1',
          stemDirection: 'up',
          events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        },
        {
          id: 'voice-2',
          stemDirection: 'down',
          events: [{ dur: '4', isRest: false, keys: ['e/4'] }],
        }
      ]
    };

    const synced = syncPrimaryVoiceFromEvents(measure);
    expect(synced.voices?.[0].events).toEqual(measure.events);
    expect(synced.voices?.[1].events).toEqual(measure.voices?.[1].events);
  });

  describe('声部2（下声）への入力ヘルパー', () => {
    it('getVoiceEvents は voiceIndex 0 のとき measure.events を返す', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      expect(getVoiceEvents(measure, 0)).toEqual(measure.events);
    });

    it('getVoiceEvents は voices が未作成の声部2に対して空配列を返す', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      expect(getVoiceEvents(measure, 1)).toEqual([]);
    });

    it('withVoiceEventsUpdated は voiceIndex 0 のとき measure.events を直接書き換える', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      const next = withVoiceEventsUpdated(measure, 0, (events) => [...events, { dur: '8', isRest: false, keys: ['d/4'] }]);
      expect(next.events).toHaveLength(2);
      expect(next.voices).toBeUndefined();
    });

    it('withVoiceEventsUpdated は voices が無い小節に声部2を新規作成し、符幹を下向きにする', () => {
      const measure: MeasureData = { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] };
      const next = withVoiceEventsUpdated(measure, 1, (events) => [...events, { dur: '2', isRest: false, keys: ['g/3'] }]);
      // 声部1（primary）は元の events から複製されて維持される
      expect(next.voices?.[0].events).toEqual(measure.events);
      // 声部2は新規作成され、追加したイベントが入る
      expect(next.voices?.[1].events).toEqual([{ dur: '2', isRest: false, keys: ['g/3'] }]);
      expect(next.voices?.[1].stemDirection).toBe('down');
      // 元の events はそのまま残り、既存互換が崩れない
      expect(next.events).toEqual(measure.events);
    });

    it('withVoiceEventsUpdated は既存の声部2から音符を削除できる', () => {
      const measure: MeasureData = {
        events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { id: 'voice-2', stemDirection: 'down', events: [
            { dur: '2', isRest: false, keys: ['g/3'] },
            { dur: '2', isRest: false, keys: ['e/3'] },
          ] },
        ],
      };
      const next = withVoiceEventsUpdated(measure, 1, (events) => {
        const copy = [...events];
        copy.splice(0, 1);
        return copy;
      });
      expect(next.voices?.[1].events).toEqual([{ dur: '2', isRest: false, keys: ['e/3'] }]);
      // 声部1は触っていないので元のまま
      expect(next.voices?.[0].events).toEqual(measure.voices?.[0].events);
    });
  });

  // PianoSystemCanvas のクリック処理は「アクティブ声部だけに作用する」ように統一されており、
  // 挿入・和音追加・休符分割はすべて withVoiceEventsUpdated(measure, activeVoiceIndex, ...) を
  // 経由する。ここでは実際のクリックハンドラと同じ更新パターンを声部0・声部1の両方で検証し、
  // 「声部1は従来どおり、声部2も同じ操作体系で編集できる」ことを保証する。
  describe('クリック位置への挿入・和音追加・休符分割（声部0/声部1で同じ更新パターン）', () => {
    it('位置指定挿入（splice）は voiceIndex 0 のとき measure.events に直接反映される', () => {
      const measure: MeasureData = {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: false, keys: ['e/4'] },
        ],
      };
      const inserted = { dur: '4', isRest: false, keys: ['d/4'] } as const;
      const next = withVoiceEventsUpdated(measure, 0, (events) => {
        const copy = [...events];
        copy.splice(1, 0, inserted);
        return copy;
      });
      expect(next.events.map((e) => e.keys[0])).toEqual(['c/4', 'd/4', 'e/4']);
      expect(next.voices).toBeUndefined();
    });

    it('位置指定挿入（splice）は voiceIndex 1 のとき声部2のクリック位置に挿入できる（以前は末尾追記のみだった）', () => {
      const measure: MeasureData = {
        events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { id: 'voice-2', stemDirection: 'down', events: [
            { dur: '4', isRest: false, keys: ['g/3'] },
            { dur: '4', isRest: false, keys: ['c/3'] },
          ] },
        ],
      };
      const inserted = { dur: '4', isRest: false, keys: ['e/3'] } as const;
      const next = withVoiceEventsUpdated(measure, 1, (events) => {
        const copy = [...events];
        copy.splice(1, 0, inserted); // 先頭と2番目の間（クリック位置）に差し込む
        return copy;
      });
      expect(next.voices?.[1].events.map((e) => e.keys[0])).toEqual(['g/3', 'e/3', 'c/3']);
      // 声部1は変更されない
      expect(next.voices?.[0].events).toEqual(measure.voices?.[0].events);
    });

    it('和音追加（既存イベントを keys 差し替えで更新）は voiceIndex 1 でも声部1と同じパターンで書ける', () => {
      const measure: MeasureData = {
        events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { id: 'voice-2', stemDirection: 'down', events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
        ],
      };
      const next = withVoiceEventsUpdated(measure, 1, (events) => {
        const copy = [...events];
        copy[0] = { ...copy[0], keys: [...copy[0].keys, 'e/3'] };
        return copy;
      });
      expect(next.voices?.[1].events[0].keys).toEqual(['c/3', 'e/3']);
    });

    it('休符クリックによる置換・分割（splice で1件→2件）は voiceIndex 1 でも動く', () => {
      const measure: MeasureData = {
        events: [{ dur: '4', isRest: false, keys: ['c/4'] }],
        voices: [
          { id: 'voice-1', events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
          { id: 'voice-2', stemDirection: 'down', events: [{ dur: '2', isRest: true, keys: ['d/3'] }] },
        ],
      };
      // 「2分休符」を「4分音符＋4分休符」に分割する想定（休符クリック時の挙動と同じ形）
      const replacement = [
        { dur: '4', isRest: false, keys: ['c/3'] },
        { dur: '4', isRest: true, keys: ['d/3'] },
      ] as const;
      const next = withVoiceEventsUpdated(measure, 1, (events) => {
        const copy = [...events];
        copy.splice(0, 1, ...replacement);
        return copy;
      });
      expect(next.voices?.[1].events).toHaveLength(2);
      expect(next.voices?.[1].events[0]).toEqual(replacement[0]);
      expect(next.voices?.[1].events[1]).toEqual(replacement[1]);
    });
  });

  describe('resolveVoiceStemDirections（2声部の符幹向き固定）', () => {
    it('声部が1つだけなら stemDirection を上書きしない（自動判定のまま）', () => {
      const voices = [{ id: 'voice-1', events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }] }];
      const resolved = resolveVoiceStemDirections(voices);
      expect(resolved).toBe(voices);
      expect(resolved[0].stemDirection).toBeUndefined();
    });

    it('声部が2つ以上あるとき、声部1は常に up、声部2は常に down に強制する', () => {
      const voices = [
        { id: 'voice-1', events: [{ dur: '4' as const, isRest: false, keys: ['c/4'] }] },
        { id: 'voice-2', events: [{ dur: '2' as const, isRest: false, keys: ['g/3'] }] },
      ];
      const resolved = resolveVoiceStemDirections(voices);
      expect(resolved[0].stemDirection).toBe('up');
      expect(resolved[1].stemDirection).toBe('down');
    });

    it('保存データに既存の stemDirection があっても、2声部共存時は up/down に強制上書きする', () => {
      const voices = [
        { id: 'voice-1', stemDirection: 'down' as const, events: [{ dur: '4' as const, isRest: false, keys: ['c/5'] }] },
        { id: 'voice-2', stemDirection: 'up' as const, events: [{ dur: '2' as const, isRest: false, keys: ['g/3'] }] },
      ];
      const resolved = resolveVoiceStemDirections(voices);
      expect(resolved[0].stemDirection).toBe('up');
      expect(resolved[1].stemDirection).toBe('down');
    });

    it('3声部以上でも voices[0] は up、voices[1] 以降はすべて down にする', () => {
      const voices = [
        { id: 'voice-1', events: [{ dur: '4' as const, isRest: false, keys: ['c/5'] }] },
        { id: 'voice-2', events: [{ dur: '4' as const, isRest: false, keys: ['e/4'] }] },
        { id: 'voice-3', events: [{ dur: '4' as const, isRest: false, keys: ['c/3'] }] },
      ];
      const resolved = resolveVoiceStemDirections(voices);
      expect(resolved.map((v) => v.stemDirection)).toEqual(['up', 'down', 'down']);
    });
  });

  describe('computeVoiceDisplayPadding（多声小節で拍が余った声部への表示用休符補完）', () => {
    // このスイート全体では「どの音価にも同じキーを返す」固定コールバックを使い、
    // 貪欲分割そのもののロジックを検証する。音価ごとのキー選択の検証は
    // defaultRestDisplayKeyForDuration との組み合わせテスト（下記）で行う。
    const fixedRestKey = () => 'b/4';

    it('4/4で下声が2拍しか埋まっていないとき、残り2拍ぶんの休符を補完する', () => {
      const events = [{ dur: '2' as const, isRest: false, keys: ['c/4'] }];
      const padding = computeVoiceDisplayPadding(events, 4, fixedRestKey);
      expect(padding).toEqual([{ dur: '2', isRest: true, keys: ['b/4'] }]);
    });

    it('声部がちょうど拍子ぶん埋まっているときは補完しない（既存の正しい多声小節を壊さない）', () => {
      const events = [
        { dur: '2' as const, isRest: false, keys: ['c/4'] },
        { dur: '2' as const, isRest: false, keys: ['e/4'] },
      ];
      expect(computeVoiceDisplayPadding(events, 4, fixedRestKey)).toEqual([]);
    });

    it('声部が拍子をオーバーしているときも補完しない（マイナスの休符を作らない）', () => {
      const events = [{ dur: '1' as const, isRest: false, keys: ['c/4'] }];
      expect(computeVoiceDisplayPadding(events, 3, fixedRestKey)).toEqual([]);
    });

    it('声部がまったく空のとき、拍子ぶん全部を休符で埋める（大きい音価から貪欲に分割）', () => {
      const padding = computeVoiceDisplayPadding([], 4, () => 'd/5');
      expect(padding).toEqual([{ dur: '1', isRest: true, keys: ['d/5'] }]);
    });

    it('半端な拍数（1.5拍）は大きい音価から貪欲に分割する（4分休符+8分休符）', () => {
      const events = [{ dur: '2' as const, isRest: false, keys: ['c/4'], dots: 1 as const }]; // 3拍
      const padding = computeVoiceDisplayPadding(events, 4.5, fixedRestKey);
      expect(padding).toEqual([
        { dur: '4', isRest: true, keys: ['b/4'] },
        { dur: '8', isRest: true, keys: ['b/4'] },
      ]);
    });

    it('付点で埋まった声部（3拍）に残り1拍を4分休符で補完する', () => {
      const events = [{ dur: '2' as const, isRest: false, keys: ['c/4'], dots: 1 as const }]; // 3拍
      const padding = computeVoiceDisplayPadding(events, 4, fixedRestKey);
      expect(padding).toEqual([{ dur: '4', isRest: true, keys: ['b/4'] }]);
    });

    it('3連符で埋まった分は tuplet 倍率を考慮して残り拍数を計算する', () => {
      // 8分音符3連符×3（1拍ぶん）を除いた残り3拍を、2分休符+4分休符で埋める
      const events = [
        { dur: '8' as const, isRest: false, keys: ['c/4'], tuplet: { numNotes: 3, notesOccupied: 2 } },
        { dur: '8' as const, isRest: false, keys: ['d/4'], tuplet: { numNotes: 3, notesOccupied: 2 } },
        { dur: '8' as const, isRest: false, keys: ['e/4'], tuplet: { numNotes: 3, notesOccupied: 2 } },
      ];
      const padding = computeVoiceDisplayPadding(events, 4, fixedRestKey);
      expect(padding).toEqual([
        { dur: '2', isRest: true, keys: ['b/4'] },
        { dur: '4', isRest: true, keys: ['b/4'] },
      ]);
    });

    it('音価ごとに異なるキーを返すコールバックを渡すと、休符ごとに個別のキーが使われる（全休符だけ標準位置が異なる実運用を想定）', () => {
      // 実運用では defaultRestDisplayKeyForDuration(clef, duration) を渡し、
      // 全休符だけ 'd/5'（第4線）、それ以外は 'b/4'（五線中央）になる。
      const restKeyForDuration = (duration: string) => (duration === '1' ? 'd/5' : 'b/4');
      const padding = computeVoiceDisplayPadding([], 4, restKeyForDuration);
      expect(padding).toEqual([{ dur: '1', isRest: true, keys: ['d/5'] }]);

      const partialPadding = computeVoiceDisplayPadding(
        [{ dur: '2' as const, isRest: false, keys: ['c/4'] }],
        4,
        restKeyForDuration
      );
      expect(partialPadding).toEqual([{ dur: '2', isRest: true, keys: ['b/4'] }]);
    });
  });

  // Issue #305: 声部2を空にしても「器」が残ると多声小節と判定され、
  // 符幹の向き固定・スラーの符幹アンカーが解けないまま残る。
  describe('空になった末尾の声部の畳み込み（Issue #305）', () => {
    const note = (key: string): NoteEvent => ({ dur: '4', isRest: false, keys: [key] });

    /** 声部1・声部2（＋必要なら声部3）を持つ小節を組み立てる。 */
    function multiVoiceMeasure(...voiceEvents: NoteEvent[][]): MeasureData {
      return {
        events: voiceEvents[0],
        voices: voiceEvents.map((events, index) => ({
          id: `voice-${index + 1}`,
          ...(index > 0 ? { stemDirection: 'down' as const } : {}),
          events,
        })),
      };
    }

    it('声部2が空になった小節は voices キーごと消え、単声部で書いた小節と同じ形になる', () => {
      const measure = multiVoiceMeasure([note('c/5')], []);
      const collapsed = collapseEmptyTrailingVoices(measure);

      expect('voices' in collapsed).toBe(false);
      expect(collapsed.events).toBe(measure.events);
      // getMeasureVoices から見ても単声部（＝多声判定 voices.length > 1 が false）になる
      expect(getMeasureVoices(collapsed)).toHaveLength(1);
    });

    it('声部2に休符が1件でも残っていれば畳まない（明示的に置いた休符は「中身」）', () => {
      const measure = multiVoiceMeasure([note('c/5')], [{ dur: '4', isRest: true, keys: ['d/3'] }]);
      expect(collapseEmptyTrailingVoices(measure)).toBe(measure);
    });

    it('声部1が空で声部2に中身がある小節は畳まない（下声だけ書いている途中を壊さない）', () => {
      const measure = multiVoiceMeasure([], [note('c/3')]);
      expect(collapseEmptyTrailingVoices(measure)).toBe(measure);
    });

    it('voices を持たない小節・声部1しか無い小節は引数の参照をそのまま返す', () => {
      const single: MeasureData = { events: [note('c/5')] };
      expect(collapseEmptyTrailingVoices(single)).toBe(single);

      const onlyPrimary = multiVoiceMeasure([note('c/5')]);
      expect(collapseEmptyTrailingVoices(onlyPrimary)).toBe(onlyPrimary);
    });

    it('3声部で末尾の1つだけ空なら、その1つだけを落として2声部で残す（#244「2を焼き込まない」）', () => {
      const measure = multiVoiceMeasure([note('c/5')], [note('c/3')], []);
      const collapsed = collapseEmptyTrailingVoices(measure);

      expect(collapsed.voices).toHaveLength(2);
      expect(collapsed.voices?.[1].events).toEqual([note('c/3')]);
    });

    it('3声部で末尾2つとも空なら、最後の1声部になるので voices ごと落ちる', () => {
      const collapsed = collapseEmptyTrailingVoices(multiVoiceMeasure([note('c/5')], [], []));
      expect('voices' in collapsed).toBe(false);
    });

    it('間に挟まった空の声部は畳まない（後ろの声部の番号がずれ、その声部の弧の指す先が変わるため）', () => {
      const measure = multiVoiceMeasure([note('c/5')], [], [note('c/3')]);
      expect(collapseEmptyTrailingVoices(measure)).toBe(measure);
    });

    it('normalizeEmptyVoicesInParts: 空の声部を含む小節だけが畳まれ、他は参照ごと据え置き', () => {
      const intact = multiVoiceMeasure([note('c/5')], [note('c/3')]);
      const parts: PartData[] = [
        { partId: 'right-hand', clef: 'treble', measures: [multiVoiceMeasure([note('c/5')], []), intact] },
        { partId: 'left-hand', clef: 'bass', measures: [{ events: [note('c/3')] }] },
      ];
      const next = normalizeEmptyVoicesInParts(parts);

      expect('voices' in next[0].measures[0]).toBe(false);
      expect(next[0].measures[1]).toBe(intact);
      // 触る必要が無かったパートは参照ごと据え置き
      expect(next[1]).toBe(parts[1]);
    });

    it('normalizeEmptyVoicesInParts: 畳む対象が無ければ引数の配列をそのまま返す', () => {
      const parts: PartData[] = [
        { partId: 'right-hand', clef: 'treble', measures: [multiVoiceMeasure([note('c/5')], [note('c/3')])] },
      ];
      expect(normalizeEmptyVoicesInParts(parts)).toBe(parts);
    });
  });
});
