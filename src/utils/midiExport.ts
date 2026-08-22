// src/utils/midiExport.ts
// SavedScoreData を MIDI ファイル（Type 1）に変換してダウンロードする。
// 参照: https://www.midi.org/specifications-old/item/the-midi-1-0-specification

import type { SavedScoreData, NoteEvent } from '../types/storage';
import { getPrimaryVoiceEvents, syncMeasuresPrimaryVoiceFromEvents } from './voiceMeasureUtils';

// 四分音符あたりのティック数（SMF 標準の 480 が一般的）
const PPQ = 480;

// 音価 → MIDI ティック数（四分音符 = PPQ）
const DUR_TO_TICKS: Record<string, number> = {
  '1': PPQ * 4, '2': PPQ * 2, '4': PPQ, '8': PPQ / 2,
  '16': PPQ / 4, '32': PPQ / 8, '64': PPQ / 16,
};

// VexFlow 音高キー → MIDI ノート番号
// 中央の C（c/4）= 60、それを基準に計算する
const STEP_SEMITONES: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

function keyToMidi(key: string): number | null {
  const m = key.match(/^([a-g])(#{1,2}|b{1,2})?\/(\d+)$/i);
  if (!m) return null;
  const step = m[1].toLowerCase();
  const acc = m[2] ?? '';
  const octave = parseInt(m[3], 10);
  const semitone = STEP_SEMITONES[step] ?? 0;
  const alter = acc === '#' ? 1 : acc === '##' ? 2 : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0;
  // MIDI note: (octave + 1) * 12 + step_semitone + alter
  // c/4 = (4+1)*12 + 0 = 60 ✓
  return (octave + 1) * 12 + semitone + alter;
}

// ─── バイト列ビルダー ───────────────────────────────────────────────

/** 可変長エンコード（MIDI の delta-time 形式） */
function varLen(value: number): number[] {
  if (value < 128) return [value];
  const bytes: number[] = [];
  let v = value;
  bytes.unshift(v & 0x7f);
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

/** 4バイト Big-Endian */
function be4(n: number): number[] {
  return [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** 2バイト Big-Endian */
function be2(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

// ─── イベント型 ───────────────────────────────────────────────────────

interface MidiEvent {
  tick: number;     // 絶対ティック位置
  bytes: number[];  // MIDI イベントバイト列（ステータスバイト含む）
}

// ─── トラック生成 ──────────────────────────────────────────────────────

/** テンポトラック（テンポ・拍子・タイトル）を生成する */
function buildTempoTrack(
  scoreTitle: string,
  bpm: number,
  timeSig: [number, number],
): number[] {
  const events: MidiEvent[] = [];

  // トラック名
  const titleBytes = Array.from(new TextEncoder().encode(scoreTitle));
  events.push({
    tick: 0,
    bytes: [0xff, 0x03, titleBytes.length, ...titleBytes],
  });

  // テンポ: マイクロ秒/四分音符
  const usPerBeat = Math.round(60_000_000 / bpm);
  events.push({
    tick: 0,
    bytes: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff],
  });

  // 拍子記号: 分母は 2^n で表すので log2
  const denominator = Math.log2(timeSig[1]);
  events.push({
    tick: 0,
    bytes: [0xff, 0x58, 0x04, timeSig[0], denominator, 24, 8],
  });

  return buildTrack(events);
}

/** ノートトラック（NoteEvent の列）を生成する */
function buildNoteTrack(
  partName: string,
  measures: Array<{ events: NoteEvent[]; bpm?: number }>,
  channel: number,
  program: number, // GM 音色番号 0-127
  globalBpm: number,
): number[] {
  const events: MidiEvent[] = [];

  // トラック名
  const nameBytes = Array.from(new TextEncoder().encode(partName));
  events.push({ tick: 0, bytes: [0xff, 0x03, nameBytes.length, ...nameBytes] });

  // プログラムチェンジ（音色設定）
  events.push({ tick: 0, bytes: [0xc0 | (channel & 0x0f), program] });

  let currentTick = 0;

  for (const measure of measures) {
    // 小節単位テンポ変更
    if (measure.bpm != null && measure.bpm !== globalBpm) {
      const us = Math.round(60_000_000 / measure.bpm);
      events.push({
        tick: currentTick,
        bytes: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff],
      });
    }

    for (const ev of getPrimaryVoiceEvents(measure)) {
      // 付点1個で1.5倍、複付点(2個)で1.75倍。四捨五入するのは、
      // 一部の音価×付点の組み合わせで割り切れない場合があるため。
      const dotMultiplier = ev.dots === 1 ? 1.5 : ev.dots === 2 ? 1.75 : 1;
      // 連符（tuplet）は notesOccupied/numNotes 倍だけ短くなる（例: 3連符は 2/3 倍）
      const tupletMultiplier = ev.tuplet && ev.tuplet.numNotes ? ev.tuplet.notesOccupied / ev.tuplet.numNotes : 1;
      const ticks = Math.round((DUR_TO_TICKS[ev.dur] ?? PPQ) * dotMultiplier * tupletMultiplier);
      if (!ev.isRest && ev.keys.length > 0) {
        const midiNotes = ev.keys.map(keyToMidi).filter((n): n is number => n !== null);
        // Note-On
        for (const midiNote of midiNotes) {
          events.push({ tick: currentTick, bytes: [0x90 | (channel & 0x0f), midiNote, 80] });
        }
        // Note-Off（次のティックの始点）
        for (const midiNote of midiNotes) {
          events.push({ tick: currentTick + ticks - 1, bytes: [0x80 | (channel & 0x0f), midiNote, 0] });
        }
      }
      currentTick += ticks;
    }
  }

  // End of Track
  events.push({ tick: currentTick, bytes: [0xff, 0x2f, 0x00] });

  return buildTrack(events);
}

/** イベント配列をソートしてデルタタイムエンコードし、チャンクに包む */
function buildTrack(events: MidiEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick);
  const body: number[] = [];
  let prev = 0;
  for (const ev of events) {
    const delta = ev.tick - prev;
    body.push(...varLen(delta), ...ev.bytes);
    prev = ev.tick;
  }
  return [0x4d, 0x54, 0x72, 0x6b, ...be4(body.length), ...body]; // MTrk + length + body
}

/**
 * SavedScoreData を MIDI バイト列（Uint8Array）に変換する。
 * Type 1 MIDI: トラック 0 = テンポ/拍子、トラック 1〜 = 各パート。
 */
export function scoreToMidi(data: SavedScoreData): Uint8Array {
  // 書き出し境界の正規化（#244 段5-3・musicXmlExport と同じ理由）
  const normalizedData: SavedScoreData = {
    ...data,
    parts: data.parts.map((p) => ({ ...p, measures: syncMeasuresPrimaryVoiceFromEvents(p.measures) })),
  };
  data = normalizedData;
  const bpm = 120; // デフォルト BPM（スコアにグローバル BPM がないため固定）
  const timeSig: [number, number] = data.timeSignature ?? [4, 4];
  const numTracks = data.parts.length + 1;

  // ヘッダーチャンク: MThd
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    ...be4(6),               // チャンクサイズ（固定 6）
    ...be2(1),               // フォーマット: Type 1
    ...be2(numTracks),       // トラック数
    ...be2(PPQ),             // 四分音符あたりのティック
  ];

  const tempoTrack = buildTempoTrack(data.metadata.title || '楽譜', bpm, timeSig);

  // GM 音色: ピアノ = 0、弦楽 = 40、木管 = 74 など
  const GM_PROGRAMS: Record<string, number> = {
    'right-hand': 0, 'left-hand': 0,
    'violin-1': 40, 'violin-2': 40, 'viola': 41, 'cello': 42,
    'melody': 0,
  };

  const noteTracks = data.parts.map((part, pi) => {
    const program = GM_PROGRAMS[part.partId] ?? 0;
    return buildNoteTrack(
      part.partId,
      part.measures,
      pi % 15, // チャンネル 0-14（ch10=ドラムを避けるため 16個中15個を使う）
      program,
      bpm,
    );
  });

  const allBytes = [...header, ...tempoTrack, ...noteTracks.flat()];
  return new Uint8Array(allBytes);
}

/** MIDI ファイルをダウンロードする */
export function downloadMidi(data: SavedScoreData, filename?: string): void {
  const bytes = scoreToMidi(data);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (filename ?? (data.metadata.title || '楽譜')) + '.mid';
  a.click();
  URL.revokeObjectURL(url);
}
