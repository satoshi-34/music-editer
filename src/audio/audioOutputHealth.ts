// src/audio/audioOutputHealth.ts
// Safari の silent failure（issue #14）を検知するための出力ヘルスチェック。
//
// Safari では「AudioContext.state === 'running' なのに実音が出ない」状態があり、
// 例外も出ないため自動フォールバックが発火しない。そこで再生開始後に
// 次の 2 段階で「音が出ているはずの状態か」を確認する。
//
// 1. currentTime 進行チェック:
//    running 表示でもレンダリングが止まっていると currentTime が進まない。
//    一定時間あけて 2 回読み、差が無ければ確実に壊れていると判定できる。
// 2. AnalyserNode 無音プローブ:
//    テスト用オシレーターを AnalyserNode にだけつなぎ（destination には接続しない＝無音）、
//    波形が観測できるかを見る。これでグラフ処理そのものが生きているかを確認できる。
//    （AnalyserNode は出力先に接続しなくても処理されると仕様で定められている）
//
// 注意: この 2 つが両方正常でも、OS の出力デバイス段で音が消えるケースは
// JavaScript からは観測できない。そのため判定は 3 値にして、
// 「unhealthy が確定したときだけ」自動復旧を動かす方針にしている。

/** ヘルスチェックの最終判定。unknown のときは何もしないこと（誤検知防止） */
export type AudioOutputVerdict = 'healthy' | 'unhealthy' | 'unknown';

export interface AudioOutputHealthReport {
  verdict: AudioOutputVerdict;
  /** AudioContext の状態。context が無い場合は 'no-context' */
  contextState: AudioContextState | 'no-context';
  /** プローブ時間内に currentTime が進んだか（context が無い場合 null） */
  timeAdvancing: boolean | null;
  /** プローブ時間内の currentTime の増分（秒） */
  currentTimeDelta: number | null;
  /** Analyser プローブで波形を観測できたか。実施できなかった場合 null */
  signalDetected: boolean | null;
  /** 診断ログ向けの一行説明 */
  reason: string;
}

export interface CheckAudioOutputHealthOptions {
  /** currentTime と Analyser を観測する時間（ミリ秒） */
  probeMs?: number;
  /** テストから時間経過を差し替えるための待機関数 */
  wait?: (ms: number) => Promise<void>;
}

const DEFAULT_PROBE_MS = 250;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Analyser プローブ。波形を観測できたら true、無音なら false、
 * 環境的に実施できなければ null を返す。
 * destination には一切接続しないため、ユーザーに聞こえる音は出ない。
 */
function startSilentProbe(context: AudioContext): {
  read: () => boolean | null;
  stop: () => void;
} {
  try {
    const oscillator = context.createOscillator();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    oscillator.connect(analyser);
    oscillator.start();

    return {
      read: () => {
        try {
          // getByteTimeDomainData は無音だと全要素 128 になる。
          // 1 でもずれた要素があれば「グラフは処理されている」と判断できる。
          const data = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteTimeDomainData(data);
          return data.some((v) => v !== 128);
        } catch {
          return null;
        }
      },
      stop: () => {
        try {
          oscillator.stop();
          oscillator.disconnect();
          analyser.disconnect();
        } catch {
          // プローブの後始末失敗は本体の判定に影響させない
        }
      },
    };
  } catch {
    return { read: () => null, stop: () => {} };
  }
}

/**
 * 再生開始後に呼び、出力経路が生きていそうかを判定する。
 * verdict が 'unhealthy' のときだけ復旧処理を動かすこと。
 */
export async function checkAudioOutputHealth(
  context: AudioContext | null | undefined,
  options: CheckAudioOutputHealthOptions = {}
): Promise<AudioOutputHealthReport> {
  const probeMs = options.probeMs ?? DEFAULT_PROBE_MS;
  const wait = options.wait ?? defaultWait;

  if (!context) {
    // エンジンが context を公開していない場合は判定材料が無い。
    // unhealthy にすると誤検知で復旧ループになるため unknown 扱いにする。
    return {
      verdict: 'unknown',
      contextState: 'no-context',
      timeAdvancing: null,
      currentTimeDelta: null,
      signalDetected: null,
      reason: 'AudioContext が取得できないため判定不能',
    };
  }

  if (context.state !== 'running') {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing: null,
      currentTimeDelta: null,
      signalDetected: null,
      reason: `AudioContext が running ではない (state=${context.state})`,
    };
  }

  const probe = startSilentProbe(context);
  const startTime = context.currentTime;
  await wait(probeMs);
  const delta = context.currentTime - startTime;
  const signalDetected = probe.read();
  probe.stop();

  const timeAdvancing = delta > 0;

  if (!timeAdvancing) {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing,
      currentTimeDelta: delta,
      signalDetected,
      reason: `running 表示なのに currentTime が ${probeMs}ms 進まない（レンダリング停止）`,
    };
  }

  if (signalDetected === false) {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing,
      currentTimeDelta: delta,
      signalDetected,
      reason: 'currentTime は進むが Analyser プローブが無音（グラフ処理が死んでいる）',
    };
  }

  return {
    verdict: signalDetected === null ? 'unknown' : 'healthy',
    contextState: context.state,
    timeAdvancing,
    currentTimeDelta: delta,
    signalDetected,
    reason: signalDetected === null
      ? 'currentTime は進むが Analyser プローブを実施できなかった'
      : '正常（currentTime 進行・プローブ波形あり）',
  };
}

/** 診断ログ用に整形する。Safari 実機からの報告にそのまま貼ってもらう想定 */
export function formatAudioHealthReport(report: AudioOutputHealthReport): string {
  return [
    `verdict=${report.verdict}`,
    `state=${report.contextState}`,
    `timeAdvancing=${report.timeAdvancing}`,
    `currentTimeDelta=${report.currentTimeDelta?.toFixed(4) ?? 'n/a'}`,
    `signalDetected=${report.signalDetected}`,
    `reason=${report.reason}`,
  ].join(' / ');
}
