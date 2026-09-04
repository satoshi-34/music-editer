// src/audio/scheduleWindow.ts
// 先読み窓の逐次スケジューリング（Issue #622）。
//
// 従来は playParts が曲全体（全曲月光で 1,182 音・ノード約 3,500）を予約時点で一括生成して
// 音声グラフへ接続していた。Web Audio はまだ鳴っていないノードも毎レンダー量子で処理するため、
// 序盤ほど音声スレッドが重くバッファ落ちし、鳴り終わったノードが外れるにつれて軽くなる
// （運用者QA 2026-09-04「先頭以外でも起き、1〜2段目で起こりがち」「8小節版では起きない」）。
// 同時発音の上限（#605）は最大 21 で余裕があり、原因は音の数ではなく**予約済みノードの数**。
//
// ここは「数秒先までだけ作り、時計が進むにつれて次を作る」計画部で、両エンジン共通
// （二重実装を作らない）。エンジンは「窓内の音を鳴らす」関数を渡すだけ。
//   - 時計は AudioContext.currentTime。一時停止（suspend）中は進まないので窓も進まず、
//     再開すれば自然に続く（別のタイマー制御を持たない）
//   - 先頭の窓は start() の中で**同期的に**作る（#610 の先読みリードと頭欠け防止を保つ）
//   - stop() で以後の窓は作らない（世代番号で、解除し損ねたタイマーの発火も無視する）
import { devTuned } from '../utils/devTuning';

/** 何秒先まで先にノードを作るか。短いほど軽いが、タブが裏に回ったときの余裕が減る */
export const LOOKAHEAD_SECONDS = 4;
/** 窓を進める間隔（ms）。LOOKAHEAD より十分短くして、タイマーの遅れで穴が空かないようにする */
export const SCHEDULE_TICK_MS = 500;

/** 実効値（dev では #596 の調整パネルで上書き。本番は定数そのもの） */
export function lookaheadSeconds(): number {
  return import.meta.env.DEV ? devTuned('audio.lookahead', LOOKAHEAD_SECONDS) : LOOKAHEAD_SECONDS;
}

export interface TimedVoice {
  /** 鳴り始め（AudioContext の秒） */
  startTime: number;
}

/**
 * 開始時刻順に並んだ一覧から、`untilTime` より前に始まる音を `cursor` から順に取り出す。
 * 純粋関数（テスト用に切り出し）。
 */
export function takeDueVoices<T extends TimedVoice>(
  sorted: readonly T[],
  cursor: number,
  untilTime: number,
): { due: T[]; nextCursor: number } {
  let i = cursor;
  while (i < sorted.length && sorted[i].startTime < untilTime) i++;
  return { due: sorted.slice(cursor, i), nextCursor: i };
}

export interface WindowedScheduler {
  /** 先頭の窓を同期的に作り、以後はタイマーで進める */
  start(): void;
  /** 以後の窓を作らない。作成済みの音はエンジン側（stopAll）が止める */
  stop(): void;
  /** 計測用: 生成済みの音の数と全体数 */
  stats(): { scheduled: number; total: number; active: boolean };
}

export function createWindowedScheduler<T extends TimedVoice>(options: {
  /** 開始時刻順に並んでいなくてよい（ここで安定ソートする） */
  voices: readonly T[];
  /** 現在の AudioContext.currentTime */
  now: () => number;
  /** 窓内の音を1つ予約する。Promise を返してもよい（非同期の予約失敗も拾う） */
  play: (voice: T) => void | Promise<void>;
  /**
   * 予約に失敗したとき（同期例外・Promise の拒否のどちらも）。呼ぶ前に窓は止めてある。
   * 先頭の窓の失敗は呼び出し側が playParts の失敗として受け取り、後続の窓の失敗は
   * ここからエンジン経由で画面へ伝える（#622 round2 P2: 無音のまま「再生中」を残さない）
   */
  onError?: (error: unknown) => void;
  lookaheadSeconds?: number;
  tickMs?: number;
}): WindowedScheduler {
  const sorted = options.voices
    .map((voice, index) => ({ voice, index }))
    .sort((a, b) => (a.voice.startTime - b.voice.startTime) || (a.index - b.index))
    .map((entry) => entry.voice);
  const lookahead = options.lookaheadSeconds ?? lookaheadSeconds();
  const tickMs = options.tickMs ?? SCHEDULE_TICK_MS;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let active = false;

  const fail = (error: unknown) => {
    if (!active) return;
    stop();
    options.onError?.(error);
  };
  const advance = () => {
    const { due, nextCursor } = takeDueVoices(sorted, cursor, options.now() + lookahead);
    cursor = nextCursor;
    for (const voice of due) {
      if (!active) return;
      try {
        const result = options.play(voice);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(fail);
        }
      } catch (error) {
        fail(error);
      }
    }
  };
  const stop = () => {
    active = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const tick = () => {
    timer = null;
    if (!active) return;
    advance();
    if (cursor >= sorted.length) {
      active = false;
      return;
    }
    timer = setTimeout(tick, tickMs);
  };

  return {
    start() {
      active = true;
      advance();
      if (cursor < sorted.length) timer = setTimeout(tick, tickMs);
      else active = false;
    },
    stop,
    stats() {
      return { scheduled: cursor, total: sorted.length, active };
    },
  };
}
