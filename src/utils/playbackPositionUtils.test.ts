import { describe, expect, it } from 'vitest';
import { buildPlaybackPositionTimeline, calculateExpandedPlaybackDurationMs, findFirstSoundingOnsetMs, findPlaybackStartExpandedIndex, resolvePlaybackStartMeasureNumber } from './playbackPositionUtils';
import type { MeasureData } from '../types/storage';
import { expandMeasuresForPlayback } from '../audio/repeatPlaybackUtils';

describe('buildPlaybackPositionTimeline', () => {
  it('単純な小節列から再生位置タイムラインを作る', () => {
    const measures: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: false, keys: ['d/4'] },
        ],
      },
      {
        events: [
          { dur: '2', isRest: false, keys: ['e/4'] },
        ],
      },
    ];

    const timeline = buildPlaybackPositionTimeline(measures, 120, [4, 4]);

    expect(timeline).toEqual([
      { atMs: 0, position: { measureIndex: 0, beatPosition: 0, noteIndex: 0 } },
      { atMs: 500, position: { measureIndex: 0, beatPosition: 1, noteIndex: 1 } },
      // 1小節目は2拍ぶんしか書かれていないが、実音エンジンは measureBeats（4/4 = 4拍）を
      // 下限に小節を進める（SimpleAudioEngine の max(実長, measureSeconds)）。
      // 以前はここが 1000ms（実長のみ）で、ハイライトが実音より先へ走っていた（#108 2巡目で統一）
      { atMs: 2000, position: { measureIndex: 1, beatPosition: 0, noteIndex: 0 } },
    ]);
  });

  it('リピートと1番括弧/2番括弧を見た目のタイムラインにも反映する', () => {
    const measures: MeasureData[] = [
      {
        events: [{ dur: '8', isRest: false, keys: ['c/4'] }],
        repeatStart: true,
      },
      {
        events: [{ dur: '8', isRest: false, keys: ['d/4'] }],
        repeatEnd: true,
        ending: 1,
      },
      {
        events: [{ dur: '8', isRest: false, keys: ['e/4'] }],
        ending: 2,
      },
    ];

    const timeline = buildPlaybackPositionTimeline(measures, 120, [3, 8]);

    expect(timeline.map(item => item.position.measureIndex)).toEqual([0, 1, 0, 2]);
  });

  // Issue #240 でテンポの有効範囲を 30〜240 へ広げたため、
  // 両端でもハイライトの予約時刻が BPM に正しく反比例することを固定する。
  it('新しい範囲の両端（30 / 240 BPM）でも予約時刻が破綻しない', () => {
    const measures: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: false, keys: ['d/4'] },
        ],
      },
    ];

    // 30 BPM なら1拍 = 2000ms、240 BPM なら1拍 = 250ms
    expect(buildPlaybackPositionTimeline(measures, 30, [4, 4]).map(item => item.atMs)).toEqual([0, 2000]);
    expect(buildPlaybackPositionTimeline(measures, 240, [4, 4]).map(item => item.atMs)).toEqual([0, 250]);
  });
  it('全パート・全声部を渡すと、鳴っている音符すべてがハイライト対象になる（#411）', () => {
    // 右手: 4分音符2つ（声部1）＋ 2分音符1つ（声部2・2拍のあいだ鳴り続ける）
    const rightHand: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/5'] },
          { dur: '4', isRest: false, keys: ['d/5'] },
        ],
        voices: [
          {
            id: 'voice-1',
            events: [
              { dur: '4', isRest: false, keys: ['c/5'] },
              { dur: '4', isRest: false, keys: ['d/5'] },
            ],
          },
          { id: 'voice-2', events: [{ dur: '2', isRest: false, keys: ['g/4'] }] },
        ],
      },
    ];
    // 左手: 2分音符1つ（右手の2つ目の音が鳴るあいだも鳴り続ける）
    const leftHand: MeasureData[] = [
      { events: [{ dur: '2', isRest: false, keys: ['c/3'] }] },
    ];

    const timeline = buildPlaybackPositionTimeline(
      rightHand, 120, [4, 4], false, 0, undefined,
      [{ partIndex: 0, measures: rightHand }, { partIndex: 1, measures: leftHand }],
    );

    // 節目は右手声部1の2音の開始（0拍・1拍）と、全声部の鳴り終わり（2拍）。
    // 終了拍の節目は帯を消すためにある（#579 round1 P1）
    expect(timeline.map(item => item.atMs)).toEqual([0, 500, 1000]);
    expect(timeline[0].targets).toEqual([
      { partIndex: 0, voiceIndex: 0, measureIndex: 0, noteIndex: 0 },
      { partIndex: 0, voiceIndex: 1, measureIndex: 0, noteIndex: 0 },
      { partIndex: 1, voiceIndex: 0, measureIndex: 0, noteIndex: 0 },
    ]);
    // 2拍目でも、伸びている声部2・左手は光ったまま（右手の声部1だけが進む）
    expect(timeline[1].targets).toEqual([
      { partIndex: 0, voiceIndex: 0, measureIndex: 0, noteIndex: 1 },
      { partIndex: 0, voiceIndex: 1, measureIndex: 0, noteIndex: 0 },
      { partIndex: 1, voiceIndex: 0, measureIndex: 0, noteIndex: 0 },
    ]);
    // 2拍かっきりで全声部が鳴り終わる → 空の targets（=全帯を消す指示）
    expect(timeline[2].targets).toEqual([]);
  });

  it('主声部が休んでいる拍でも、他声部が鳴っていればタイムラインの節目になる（#411）', () => {
    // 右手は1拍目が休符・左手だけが1拍目に鳴る
    const rightHand: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: true, keys: ['b/4'] },
          { dur: '4', isRest: false, keys: ['d/5'] },
        ],
      },
    ];
    const leftHand: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/3'] }] },
    ];

    const timeline = buildPlaybackPositionTimeline(
      rightHand, 120, [4, 4], false, 0, undefined,
      [{ partIndex: 0, measures: rightHand }, { partIndex: 1, measures: leftHand }],
    );

    expect(timeline.map(item => item.atMs)).toEqual([0, 500, 1000]);
    // 1拍目は左手だけ。主声部が鳴っていない拍でも画面が動く（従来は節目にすらならなかった）
    expect(timeline[0].targets).toEqual([
      { partIndex: 1, voiceIndex: 0, measureIndex: 0, noteIndex: 0 },
    ]);
    expect(timeline[1].targets).toEqual([
      { partIndex: 0, voiceIndex: 0, measureIndex: 0, noteIndex: 1 },
    ]);
    expect(timeline[2].targets).toEqual([]);
  });

  it('音符が終わって無音になる拍で targets が空になり、帯を消せる（#579 round1 P1）', () => {
    // 四分音符1つ + 休符3拍。開始拍だけを節目にすると帯が小節末まで残っていた
    const measures: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: false, keys: ['c/4'] },
          { dur: '4', isRest: true, keys: [] },
          { dur: '2', isRest: true, keys: [] },
        ],
      },
      { events: [{ dur: '4', isRest: false, keys: ['d/4'] }] },
    ];

    const timeline = buildPlaybackPositionTimeline(
      measures, 120, [4, 4], false, 0, undefined,
      [{ partIndex: 0, measures }],
    );

    // 0拍=発音、1拍=鳴り終わり（消灯）、次小節頭=次の発音、その鳴り終わり
    expect(timeline.map(item => item.atMs)).toEqual([0, 500, 2000, 2500]);
    expect(timeline[0].targets).toEqual([
      { partIndex: 0, voiceIndex: 0, measureIndex: 0, noteIndex: 0 },
    ]);
    expect(timeline[1].targets).toEqual([]);
    expect(timeline[2].targets).toEqual([
      { partIndex: 0, voiceIndex: 0, measureIndex: 1, noteIndex: 0 },
    ]);
    expect(timeline[3].targets).toEqual([]);
  });

  it('小節終端で鳴り終わり、次小節が休符で始まる場合も境界で消灯する（#579 round2 P1）', () => {
    // 全音符（小節いっぱい鳴る）→ 次小節は1拍休んでから発音。
    // 境界の消灯節目を削ると、全音符の帯が次の発音（5拍目）まで残ってしまう
    const measures: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
      {
        events: [
          { dur: '4', isRest: true, keys: [] },
          { dur: '4', isRest: false, keys: ['d/4'] },
          { dur: '2', isRest: true, keys: [] },
        ],
      },
    ];

    const timeline = buildPlaybackPositionTimeline(
      measures, 120, [4, 4], false, 0, undefined,
      [{ partIndex: 0, measures }],
    );

    // 0=全音符の発音、2000=小節境界の消灯、2500=次小節の発音、3000=その消灯
    expect(timeline.map(item => item.atMs)).toEqual([0, 2000, 2500, 3000]);
    expect(timeline[1].targets).toEqual([]);
    expect(timeline[2].targets).toEqual([
      { partIndex: 0, voiceIndex: 0, measureIndex: 1, noteIndex: 1 },
    ]);
  });

  it('highlightParts を渡さない従来の呼び出しでは targets を付けない（後方互換）', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'] }] },
    ];

    const timeline = buildPlaybackPositionTimeline(measures, 120, [4, 4]);

    expect(timeline[0].targets).toBeUndefined();
  });
});

describe('途中再生（#108）', () => {
  it('startExpandedIndex を渡すと、その展開位置から atMs=0 で始まるタイムラインになる', () => {
    const measures: MeasureData[] = [
      { events: [{ dur: '4', isRest: false, keys: ['c/4'] }, { dur: '4', isRest: false, keys: ['d/4'] }] },
      { events: [{ dur: '2', isRest: false, keys: ['e/4'] }, { dur: '2', isRest: false, keys: ['e/4'] }] },
      { events: [{ dur: '4', isRest: false, keys: ['f/4'] }] },
    ];
    // 2小節目（index 1）から: 先頭の atMs は 0、位置は元の小節番号のまま
    const timeline = buildPlaybackPositionTimeline(measures, 120, [4, 4], false, 1);
    expect(timeline[0]).toEqual({ atMs: 0, position: { measureIndex: 1, beatPosition: 0, noteIndex: 0 } });
    // 3小節目は「2小節目の長さ（2分×2 = 4拍 = 2000ms @120BPM）」後に来る
    const third = timeline.find(item => item.position.measureIndex === 2)!;
    expect(third.atMs).toBe(2000);
    // 開始位置より前（1小節目）の項目は含まれない
    expect(timeline.some(item => item.position.measureIndex === 0)).toBe(false);
  });

  it('findPlaybackStartExpandedIndex はリピート展開後の「最初の出現」を返す', () => {
    // 1小節目 → 2小節目(:||で1へ戻る) → 1,2 → 3 のような展開を持つ譜面
    const measures: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
      { events: [{ dur: '1', isRest: false, keys: ['d/4'] }], repeatEnd: true },
      { events: [{ dur: '1', isRest: false, keys: ['e/4'] }] },
    ];
    const expanded = expandMeasuresForPlayback(measures);
    // まず展開順そのものを固定する（:|| で先頭へ戻って2周目 → 3小節目）
    expect(expanded.map(i => i.sourceMeasureIndex)).toEqual([0, 1, 0, 1, 2]);
    // 2小節目は2回鳴るが、開始位置は「最初の出現」（index 1。2周目の index 3 ではない）
    expect(findPlaybackStartExpandedIndex(expanded, 1)).toBe(1);
    expect(findPlaybackStartExpandedIndex(expanded, 2)).toBe(4);
    // 存在しない小節番号 → その先の最初の小節（すべて手前なら 0 = 先頭）
    expect(findPlaybackStartExpandedIndex(expanded, 99)).toBe(0);
  });
});

describe('calculateExpandedPlaybackDurationMs（展開済み列の残り時間）', () => {
  it('展開済み列を再展開しない（repeatEnd が残っていても二重に数えない）', () => {
    // 展開済みの並び [0,1] を模す。小節1に repeatEnd が残っていても長さは 2小節ぶんのまま
    const expanded: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
      { events: [{ dur: '1', isRest: false, keys: ['d/4'] }], repeatEnd: true },
    ];
    // 4/4 @120BPM: 1小節 = 2000ms × 2
    expect(calculateExpandedPlaybackDurationMs(expanded, 120, [4, 4])).toBe(4000);
  });

  it('声部2だけの小節も演奏対象として数える（主声部が空でも 0 秒にならない）', () => {
    const expanded: MeasureData[] = [
      {
        events: [],
        voices: [
          { id: 'v1', events: [] },
          { id: 'v2', events: [{ dur: '1', isRest: false, keys: ['c/3'] }], stemDirection: 'down' },
        ],
      },
    ];
    expect(calculateExpandedPlaybackDurationMs(expanded, 120, [4, 4])).toBe(2000);
  });

  it('末尾の完全な空小節は数えず、途中の空小節は拍子ぶん数える', () => {
    const expanded: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
      { events: [] },
      { events: [{ dur: '1', isRest: false, keys: ['d/4'] }] },
      { events: [] },
      { events: [] },
    ];
    // 実小節2 + 途中の空小節1 = 3小節ぶん。末尾の空小節2つは含まない
    expect(calculateExpandedPlaybackDurationMs(expanded, 120, [4, 4])).toBe(6000);
  });

  it('再生速度（%）適用後の実効テンポを 30〜240 へ丸め直さない（#544 round1 P1）', () => {
    // 基準 40BPM × 25% = 10BPM。譜面用の clampBpm を通すと 30BPM に戻り、
    // 4/4 の1小節が実音 24 秒に対してタイマー 8 秒で止まってしまっていた
    const slow: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }], bpm: 10 },
    ];
    expect(calculateExpandedPlaybackDurationMs(slow, 10, [4, 4])).toBe(24000);

    // 240BPM × 200% = 480BPM。丸め直すと実音終了後もタイマーだけ倍の時間残る
    const fast: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }], bpm: 480 },
    ];
    expect(calculateExpandedPlaybackDurationMs(fast, 480, [4, 4])).toBe(500);
  });
});

describe('findFirstSoundingOnsetMs（最初に音が鳴る時刻・#618 round1 P1-1）', () => {
  it('先頭の小節に音符があれば 0（拍の頭から鳴る）', () => {
    const expanded: MeasureData[] = [
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
    ];
    expect(findFirstSoundingOnsetMs(expanded, 120, [4, 4])).toBe(0);
  });

  it('先頭が全休符なら、次に音符が来る小節の時刻を返す（自己診断の窓の外だと分かる）', () => {
    const expanded: MeasureData[] = [
      { events: [{ dur: '1', isRest: true, keys: ['b/4'] }] },
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }] },
    ];
    // 4/4 @120BPM: 1小節 = 2000ms
    expect(findFirstSoundingOnsetMs(expanded, 120, [4, 4])).toBe(2000);
  });

  it('小節の途中から鳴り始める（弱起・休符始まり）ときはその拍の時刻', () => {
    const expanded: MeasureData[] = [
      {
        events: [
          { dur: '4', isRest: true, keys: ['b/4'] },
          { dur: '4', isRest: false, keys: ['c/4'] },
        ],
      },
    ];
    // 120BPM の4分音符 = 500ms
    expect(findFirstSoundingOnsetMs(expanded, 120, [4, 4])).toBe(500);
  });

  it('声部2だけに音がある小節も見る（主声部が休符でも鳴っている）', () => {
    const expanded: MeasureData[] = [
      {
        events: [{ dur: '1', isRest: true, keys: ['b/4'] }],
        voices: [
          { id: 'v1', events: [{ dur: '1', isRest: true, keys: ['b/4'] }] },
          { id: 'v2', events: [{ dur: '1', isRest: false, keys: ['c/3'] }], stemDirection: 'down' },
        ],
      },
    ];
    expect(findFirstSoundingOnsetMs(expanded, 120, [4, 4])).toBe(0);
  });

  it('音符が1つも無ければ null（鳴らないのが正しい譜面）', () => {
    const expanded: MeasureData[] = [
      { events: [{ dur: '1', isRest: true, keys: ['b/4'] }] },
      { events: [] },
    ];
    expect(findFirstSoundingOnsetMs(expanded, 120, [4, 4])).toBeNull();
  });

  it('小節ごとのテンポ変更を反映する（遅い小節ぶんだけ後ろへずれる）', () => {
    const expanded: MeasureData[] = [
      { events: [{ dur: '1', isRest: true, keys: ['b/4'] }], bpm: 60 },
      { events: [{ dur: '1', isRest: false, keys: ['c/4'] }], bpm: 60 },
    ];
    // 60BPM の 4/4 は1小節 4000ms
    expect(findFirstSoundingOnsetMs(expanded, 60, [4, 4])).toBe(4000);
  });
});

describe('resolvePlaybackStartMeasureNumber（小節番号の指定・#545）', () => {
  it('画面の小節番号（1始まり）を配列のインデックス（0始まり）へ直す', () => {
    expect(resolvePlaybackStartMeasureNumber('1', 8)).toEqual({ ok: true, measureIndex: 0 });
    expect(resolvePlaybackStartMeasureNumber('5', 8)).toEqual({ ok: true, measureIndex: 4 });
    // 最終小節ちょうどは受け付ける（境界）
    expect(resolvePlaybackStartMeasureNumber('8', 8)).toEqual({ ok: true, measureIndex: 7 });
  });

  it('前後の空白は無視する', () => {
    expect(resolvePlaybackStartMeasureNumber('  3 ', 8)).toEqual({ ok: true, measureIndex: 2 });
  });

  it('0以下・総小節数超は範囲外として弾く', () => {
    expect(resolvePlaybackStartMeasureNumber('0', 8)).toEqual({ ok: false, reason: 'outOfRange' });
    expect(resolvePlaybackStartMeasureNumber('-2', 8)).toEqual({ ok: false, reason: 'outOfRange' });
    expect(resolvePlaybackStartMeasureNumber('9', 8)).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('数字として読めない入力は弾く（parseInt の部分解釈に頼らない）', () => {
    expect(resolvePlaybackStartMeasureNumber('', 8)).toEqual({ ok: false, reason: 'notANumber' });
    expect(resolvePlaybackStartMeasureNumber('３', 8)).toEqual({ ok: false, reason: 'notANumber' });
    expect(resolvePlaybackStartMeasureNumber('3abc', 8)).toEqual({ ok: false, reason: 'notANumber' });
    expect(resolvePlaybackStartMeasureNumber('2.5', 8)).toEqual({ ok: false, reason: 'notANumber' });
  });

  it('再生できる小節がまだ無い譜面は、番号の前に「小節が無い」を理由にする', () => {
    expect(resolvePlaybackStartMeasureNumber('1', 0)).toEqual({ ok: false, reason: 'noMeasures' });
  });
});
