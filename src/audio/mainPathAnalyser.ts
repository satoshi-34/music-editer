// src/audio/mainPathAnalyser.ts
// 「実音経路」（マスターゲイン → destination）に常設する診断専用の AnalyserNode。
//
// なぜ必要か（issue #618）:
// 従来のヘルスチェックは、destination へ繋がない別経路のオシレーターで
// 「グラフ処理が生きているか」だけを見ていた。そのため、SoundFont の実音経路が
// 無音になっているタブでも `signalDetected=true`（＝healthy）と報告してしまい、
// 利用者の「音が出ない」と診断結果が食い違っていた。
// マスターゲインの直後に AnalyserNode を分岐させて挿しておけば、
// 実際にスピーカーへ向かっている信号そのものを測れる。
//
// 注意:
// - AnalyserNode は「入力があれば処理される」と Web Audio の仕様で決まっているため、
//   出力側（destination）へ繋がなくてよい。繋がないので二重に音が出ることもない。
// - 分岐（tap）なので、マスターゲイン → destination の本線には一切影響しない。
//
// 実装は SoundFontEngine と SimpleAudioEngine の両方から使う。
// 同じ処理を2枚持つと片方だけ直る事故になるため、最初から共有の関数にしている。

/** Analyser の解像度。波形のピークを測るだけなので小さめで足りる */
const MAIN_PATH_FFT_SIZE = 1024;

/**
 * いまの context 用の診断 Analyser を用意する。
 * 既存のものが同じ context のものならそのまま使い回す
 * （context を作り直したときだけ新しく作る）。
 * 作成に失敗した環境（AnalyserNode 非対応・テスト用のモック等）では null を返し、
 * 呼び出し側は「診断できないだけ」で通常の再生を続けられるようにする。
 */
export function ensureMainPathAnalyser(
  context: AudioContext,
  existing: AnalyserNode | null
): AnalyserNode | null {
  if (existing && existing.context === context) {
    return existing;
  }
  try {
    const analyser = context.createAnalyser();
    analyser.fftSize = MAIN_PATH_FFT_SIZE;
    return analyser;
  } catch {
    // 診断用の枝が作れないことを再生の失敗にはしない
    return null;
  }
}

/**
 * マスターゲインの出口を診断 Analyser へ分岐させる。
 * 本線（マスターゲイン → destination）はそのままで、ここでは枝を1本足すだけ。
 */
export function tapOutputToMainPathAnalyser(
  outputNode: AudioNode,
  analyser: AnalyserNode | null
): void {
  if (!analyser) {
    return;
  }
  try {
    outputNode.connect(analyser);
  } catch {
    // 分岐に失敗しても本線の音は出るため、再生を止めない
  }
}

/**
 * Analyser が今この瞬間に見ている波形のピーク振幅（0〜1）を読む。
 * 読めない環境では null を返す。
 *
 * 精度の都合で getFloatTimeDomainData を優先し、
 * 未実装のブラウザでは 8bit 版（1/128 刻み）へ落とす。
 */
export function readMainPathPeak(analyser: AnalyserNode | null): number | null {
  if (!analyser) {
    return null;
  }
  try {
    if (typeof analyser.getFloatTimeDomainData === 'function') {
      const data = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(data);
      let peak = 0;
      for (const value of data) {
        const amplitude = Math.abs(value);
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
      return peak;
    }
    if (typeof analyser.getByteTimeDomainData === 'function') {
      // 8bit 版は「無音 = 128」を中心に振れるため、128 からのずれを 0〜1 へ直す
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const value of data) {
        const amplitude = Math.abs(value - 128) / 128;
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
      return peak;
    }
    return null;
  } catch {
    return null;
  }
}

/** ピーク観測を続けている間の窓口 */
export interface MainPathPeakWatch {
  /** これまでに観測した最大のピーク（1度も読めていなければ null） */
  getPeak: () => number | null;
  /** 観測を終える。必ず呼ぶこと（setInterval が残り続けるため） */
  stop: () => void;
}

/** 既定の観測間隔。発音の山を取りこぼさない程度に細かく見る */
const DEFAULT_WATCH_INTERVAL_MS = 50;

/**
 * 発音直後からピークを拾い続ける観測を始める。
 *
 * ヘルスチェックは再生開始の 600ms 後に走るが、音色プレビュー（0.5秒）のように
 * 短い音は「チェックが始まったときにはもう鳴り終わっている」ことがある。
 * その瞬間だけを測ると正常なタブでも無音に見えてしまうため、
 * 再生を始めた時点から観測を回し、最大値を持ち回る。
 */
export function startMainPathPeakWatch(
  analyser: AnalyserNode | null,
  options: { intervalMs?: number } = {}
): MainPathPeakWatch {
  let peak: number | null = readMainPathPeak(analyser);
  if (!analyser || typeof window === 'undefined') {
    return { getPeak: () => peak, stop: () => {} };
  }

  const timerId = window.setInterval(() => {
    const sample = readMainPathPeak(analyser);
    if (sample === null) {
      return;
    }
    peak = peak === null ? sample : Math.max(peak, sample);
  }, options.intervalMs ?? DEFAULT_WATCH_INTERVAL_MS);

  return {
    getPeak: () => peak,
    stop: () => window.clearInterval(timerId),
  };
}
