// src/audio/polyphonyLimit.ts
// 同時発音数の上限（ボイススティール）。Issue #605。
//
// ペダル延長（#549/#560）で各音の鳴り終わりが解除位置まで延びると、全曲では保持中の
// ボイスが数十〜百単位に積み上がり、AudioContext の処理が追いつかずプツプツ途切れる
// （運用者QA 2026-09-03・全曲月光で実測。8小節版では起きない）。
//
// 両エンジンとも譜面全体を**予約時点で**組み立てる（開始時刻・長さが先に全部分かる）ので、
// 上限管理は実行時ではなく予約前の静的な計算で済む。ここは純粋関数で、エンジンは
// 「開始・終了時刻の一覧を渡す → 終了時刻が詰められた一覧を受け取る」だけ。
// 内蔵音源・SoundFont で同じ規約（二重実装を作らない）。
import { devTuned } from '../utils/devTuning';

/**
 * 同時に鳴らしてよいボイス数の上限。超えたぶんは**最も古く鳴り始めたボイス**から
 * 止める（ペダル延長中の音は減衰が進んでいるため、聴感上の影響が小さい順に切れる）。
 * 値は dev の調整パネル（#596）で運用者の耳で確定する。
 */
export const MAX_POLYPHONY = 48;

/** 実効値（dev では #596 の上書きを通す。本番は定数そのもの） */
export function maxPolyphony(): number {
  return import.meta.env.DEV ? devTuned('audio.maxPolyphony', MAX_POLYPHONY) : MAX_POLYPHONY;
}

export interface VoiceSpan {
  /** 鳴り始め（AudioContext の秒） */
  startTime: number;
  /** 鳴り終わり（AudioContext の秒）。詰められた場合はここが縮む */
  endTime: number;
}

export interface PolyphonyLimitResult<T extends VoiceSpan> {
  /** 入力と同じ順序。終了時刻だけが詰められている（同一オブジェクトではなく複製） */
  voices: T[];
  /** 詰める前の最大同時発音数（計測用・#605 仕様1） */
  peakBefore: number;
  /** 終了時刻を詰めたボイス数 */
  stolen: number;
  /** 詰めた結果、長さが 0 になった（＝鳴らさなくてよい）ボイス数 */
  dropped: number;
}

/**
 * 同時発音数を max 以下に抑える。開始時刻順に走査し、その時点で鳴っているボイスが
 * max に達していたら、最も古く鳴り始めたものの終了時刻を新しいボイスの開始時刻まで詰める。
 * 同時刻に max を超える和音は、入力順の早いものから詰められて長さ 0（dropped）になる。
 */
export function limitPolyphony<T extends VoiceSpan>(input: T[], max: number): PolyphonyLimitResult<T> {
  const cap = Math.max(1, Math.floor(max));
  // 入力順は保ったまま返したいので、複製を作ってから index つきで開始時刻順に並べる
  const voices = input.map((voice) => ({ ...voice }));
  const order = voices.map((_, index) => index).sort((a, b) => {
    const diff = voices[a].startTime - voices[b].startTime;
    return diff !== 0 ? diff : a - b;
  });
  // 鳴っている最中のボイス（index）。鳴り始めの古い順に並んでいる
  const active: number[] = [];
  let peakBefore = 0;
  let stolen = 0;
  for (const index of order) {
    const voice = voices[index];
    // 鳴り終わったものを外す（詰められた後の終了時刻で判定する）
    for (let i = active.length - 1; i >= 0; i--) {
      if (voices[active[i]].endTime <= voice.startTime) active.splice(i, 1);
    }
    peakBefore = Math.max(peakBefore, active.length + 1);
    while (active.length >= cap) {
      const oldest = active.shift()!;
      voices[oldest].endTime = Math.min(voices[oldest].endTime, voice.startTime);
      stolen++;
    }
    active.push(index);
  }
  const dropped = voices.filter((voice) => voice.endTime <= voice.startTime).length;
  return { voices, peakBefore, stolen, dropped };
}
