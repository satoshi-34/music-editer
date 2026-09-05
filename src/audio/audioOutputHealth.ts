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
// 2. 実音経路のピーク（issue #618・これが主判定）:
//    マスターゲインの直後に常設した AnalyserNode（src/audio/mainPathAnalyser.ts）で、
//    実際にスピーカーへ向かっている信号の振幅を測る。
//    「音が出ない」と言っているタブで無音を実測できるのはここだけ。
// 3. AnalyserNode 無音プローブ（issue #618 で補助へ格下げ）:
//    テスト用オシレーターを AnalyserNode にだけつなぎ（destination には接続しない＝無音）、
//    波形が観測できるかを見る。これでグラフ処理そのものが生きているかを確認できる。
//    （AnalyserNode は出力先に接続しなくても処理されると仕様で定められている）
//    ただしプローブは実音とは別の経路なので、実音経路が無音でも波形が出てしまう。
//    実音経路を測れたときは、こちらの結果で判定を左右させない。
//
// 注意: これらが全て正常でも、OS の出力デバイス段で音が消えるケースは
// JavaScript からは観測できない。そのため判定は 3 値にして、
// 「unhealthy が確定したときだけ」自動復旧を動かす方針にしている。

import { readMainPathPeak } from './mainPathAnalyser';

/** ヘルスチェックの最終判定。unknown のときは何もしないこと（誤検知防止） */
export type AudioOutputVerdict = 'healthy' | 'unhealthy' | 'unknown';

/**
 * 実音経路が「無音」と言い切るピークのしきい値（issue #618）。
 *
 * 実測（Chromium・音色プレビューと再生）では、正常なタブのピークは 0.006〜0.04 で、
 * 経路が切れているときはちょうど 0.0 になる（無音は誤差ではなく厳密な 0）。
 * 誤って「壊れています」と出す方が実害が大きいので、しきい値は下側に大きく振り、
 * いちばん小さかった実測値（0.006）の 6 分の 1 に置いている。
 * 8bit 版の Analyser（1/128 ≒ 0.0078 刻み）でも 1 目盛の振れを有音と判定できる。
 */
export const MAIN_PATH_SILENCE_THRESHOLD = 0.001;

export interface AudioOutputHealthReport {
  verdict: AudioOutputVerdict;
  /** AudioContext の状態。context が無い場合は 'no-context' */
  contextState: AudioContextState | 'no-context';
  /** プローブ時間内に currentTime が進んだか（context が無い場合 null） */
  timeAdvancing: boolean | null;
  /** プローブ時間内の currentTime の増分（秒） */
  currentTimeDelta: number | null;
  /**
   * 音が出ていると判断できたか。
   * 実音経路を測れたときはその結果（issue #618）、測れないときは従来どおりプローブの結果。
   * どちらも実施できなかった場合は null。
   */
  signalDetected: boolean | null;
  /** 実音経路（マスターゲイン直後）で観測したピーク振幅。測れない場合 null */
  mainPathPeak: number | null;
  /** 実音経路が無音だったか（＝このタブの音声経路が壊れている疑い） */
  mainPathSilent: boolean;
  /** 補助のプローブ（別経路のオシレーター）で波形を観測できたか */
  probeSignalDetected: boolean | null;
  /** 診断ログ向けの一行説明 */
  reason: string;
  /**
   * いま音が出ているはずの出力先デバイス名（Issue #521）。
   * 取得できない環境（API 非対応・ラベル非公開）では null。
   */
  outputDeviceLabel: string | null;
}

export interface CheckAudioOutputHealthOptions {
  /** currentTime と Analyser を観測する時間（ミリ秒） */
  probeMs?: number;
  /** テストから時間経過を差し替えるための待機関数 */
  wait?: (ms: number) => Promise<void>;
  /**
   * 出力先デバイス名の取得方法（テストから差し替えるための口）。
   * 省略時は navigator.mediaDevices を使う。
   */
  resolveOutputDeviceLabel?: () => Promise<string | null>;
  /** 実音経路（マスターゲイン直後）に常設した診断用 AnalyserNode（issue #618） */
  mainPathAnalyser?: AnalyserNode | null;
  /**
   * ヘルスチェックが始まる前（発音直後）に観測しておいたピーク。
   * 音色プレビュー（0.5秒）のような短い音はチェック開始時には鳴り終わっているため、
   * startMainPathPeakWatch で拾っておいた最大値をここへ渡す。
   */
  observedMainPathPeak?: number | null;
  /** 無音と判断するしきい値（既定 MAIN_PATH_SILENCE_THRESHOLD） */
  mainPathPeakThreshold?: number;
  /**
   * 無音が正常な場合（音量スライダーが 0・休符だけの譜面など）に true。
   * このときピークが 0 なのは故障ではないため、実音経路での判定を行わない。
   */
  silenceIsExpected?: boolean;
}

const DEFAULT_PROBE_MS = 250;

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * いまの音声出力先デバイス名を取得する（Issue #521）。
 *
 * 「アプリは信号を出しているのに聞こえない」場合、残る不明点は出力先だけなので、
 * 診断結果にデバイス名を添えられるようにする（#520 の実例: 外部モニターへ音が流れていた）。
 *
 * 注意: enumerateDevices のラベルはマイク権限を与えていないブラウザでは空文字になる。
 * その場合は「取得できなかった」として null を返し、表示側は従来どおりの文面に戻す
 * （機能劣化を出さないため。受入条件2）。
 */
export async function resolveAudioOutputDeviceLabel(
  mediaDevices?: MediaDevices | null
): Promise<string | null> {
  const devices = mediaDevices
    ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : null);
  if (!devices || typeof devices.enumerateDevices !== 'function') return null;
  try {
    const list = await devices.enumerateDevices();
    const outputs = list.filter((device) => device.kind === 'audiooutput');
    if (outputs.length === 0) return null;
    // 既定デバイス（deviceId === 'default'）が「いま鳴っている先」。**先に全出力から**
    // 既定を選び、そのラベルが空なら null にする（round1 P2: ラベルで絞ってから探すと、
    // 既定のラベルだけ空の環境で別デバイスを「現在の出力先」と誤表示する）
    const preferred = outputs.find((device) => device.deviceId === 'default') ?? outputs[0];
    return preferred.label || null;
  } catch {
    // 権限拒否や未対応環境で診断そのものを止めない
    return null;
  }
}

/** 出力先が分かっているときだけ「（出力先: 〜）」を付ける */
function outputDeviceSuffix(label: string | null): string {
  return label ? `（出力先: ${label}）` : '';
}

/**
 * 「音が出ているはずなのに聞こえない」ときの次の一手（AGENTS.md「行き止まりは喋る」）。
 * 判定が healthy でも実際に無音なら、残る原因は OS 側の出力先しかない。
 */
export const AUDIO_OUTPUT_CHECK_HINT =
  '音が聞こえない場合は、パソコンの音声の出力先（メニューバーの音量→出力先）をご確認ください。';

/**
 * 画面の通知・診断ログに添える一文を作る（Issue #521）。
 * デバイス名を取得できた場合だけ出力先を含め、取れなければヒントだけを返す。
 */
export function describeAudioOutputDestination(report: AudioOutputHealthReport): string {
  const suffix = outputDeviceSuffix(report.outputDeviceLabel);
  return suffix ? `現在の出力先: ${report.outputDeviceLabel}。${AUDIO_OUTPUT_CHECK_HINT}` : AUDIO_OUTPUT_CHECK_HINT;
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
  const analyser = options.mainPathAnalyser ?? null;
  const threshold = options.mainPathPeakThreshold ?? MAIN_PATH_SILENCE_THRESHOLD;
  // 出力先デバイス名は判定そのものには使わない（表示用の補助情報）。
  // 取得に失敗しても null のまま進めて、従来どおりの判定を続ける
  const resolveLabel = options.resolveOutputDeviceLabel ?? (() => resolveAudioOutputDeviceLabel());
  // 補助情報の取得失敗が判定全体を巻き込まないよう、ここでも失敗を null へ閉じる
  //（round1 P3: 差し替え関数が reject すると report が返らず診断・自動復旧ごと省略される）
  const outputDeviceLabel = await resolveLabel().catch(() => null);

  if (!context) {
    // エンジンが context を公開していない場合は判定材料が無い。
    // unhealthy にすると誤検知で復旧ループになるため unknown 扱いにする。
    return {
      verdict: 'unknown',
      contextState: 'no-context',
      timeAdvancing: null,
      currentTimeDelta: null,
      signalDetected: null,
      mainPathPeak: null,
      mainPathSilent: false,
      probeSignalDetected: null,
      reason: 'AudioContext が取得できないため判定不能',
      // context が無くても「どこへ出そうとしていたか」は診断の手がかりになる
      outputDeviceLabel,
    };
  }

  if (context.state !== 'running') {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing: null,
      currentTimeDelta: null,
      signalDetected: null,
      mainPathPeak: null,
      mainPathSilent: false,
      probeSignalDetected: null,
      reason: `AudioContext が running ではない (state=${context.state})`,
      outputDeviceLabel,
    };
  }

  const probe = startSilentProbe(context);
  const startTime = context.currentTime;
  // 待つ前と後の 2 回読むのは、観測窓の中で音が始まった／鳴り終わった場合に
  // 片方だけでは山を取りこぼすため（発音直後からの観測値も合わせて最大を採る）
  const peakBeforeWait = readMainPathPeak(analyser);
  await wait(probeMs);
  const peakAfterWait = readMainPathPeak(analyser);
  const delta = context.currentTime - startTime;
  const probeSignalDetected = probe.read();
  probe.stop();

  const observedPeaks = [options.observedMainPathPeak, peakBeforeWait, peakAfterWait]
    .filter((value): value is number => typeof value === 'number');
  const mainPathPeak = observedPeaks.length === 0 ? null : Math.max(...observedPeaks);
  // 「鳴らないのが正しい」ときの無音は故障ではないので、実音経路での判定は行わない
  const canJudgeByMainPath = mainPathPeak !== null && options.silenceIsExpected !== true;
  const mainPathSilent = canJudgeByMainPath && mainPathPeak < threshold;
  // 実音経路を測れたならそれが主判定。測れないときだけ従来のプローブ結果を使う（issue #618）
  const signalDetected = canJudgeByMainPath ? !mainPathSilent : probeSignalDetected;
  const peakText = mainPathPeak === null ? 'n/a' : mainPathPeak.toFixed(4);

  const timeAdvancing = delta > 0;

  if (!timeAdvancing) {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing,
      currentTimeDelta: delta,
      signalDetected,
      mainPathPeak,
      mainPathSilent,
      probeSignalDetected,
      reason: `running 表示なのに currentTime が ${probeMs}ms 進まない（レンダリング停止）`,
      outputDeviceLabel,
    };
  }

  if (mainPathSilent) {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing,
      currentTimeDelta: delta,
      signalDetected,
      mainPathPeak,
      mainPathSilent,
      probeSignalDetected,
      reason: `実音経路（マスターゲイン出口）が無音（mainPathPeak=${peakText}）。このタブの音声経路が壊れている`,
      outputDeviceLabel,
    };
  }

  if (canJudgeByMainPath) {
    // 実音経路で信号を観測できているなら、補助プローブの結果は判定に使わない
    return {
      verdict: 'healthy',
      contextState: context.state,
      timeAdvancing,
      currentTimeDelta: delta,
      signalDetected,
      mainPathPeak,
      mainPathSilent,
      probeSignalDetected,
      reason: `正常（currentTime 進行・実音経路のピーク ${peakText}）`,
      outputDeviceLabel,
    };
  }

  if (probeSignalDetected === false) {
    return {
      verdict: 'unhealthy',
      contextState: context.state,
      timeAdvancing,
      currentTimeDelta: delta,
      signalDetected,
      mainPathPeak,
      mainPathSilent,
      probeSignalDetected,
      reason: 'currentTime は進むが Analyser プローブが無音（グラフ処理が死んでいる）',
      outputDeviceLabel,
    };
  }

  return {
    verdict: probeSignalDetected === null ? 'unknown' : 'healthy',
    contextState: context.state,
    timeAdvancing,
    currentTimeDelta: delta,
    signalDetected,
    mainPathPeak,
    mainPathSilent,
    probeSignalDetected,
    reason: probeSignalDetected === null
      ? 'currentTime は進むが Analyser プローブを実施できなかった'
      : '正常（currentTime 進行・プローブ波形あり）',
    outputDeviceLabel,
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
    // 実音経路の実測値。切り分けをこの1行で済ませるため必ず出す（issue #618）
    `mainPathPeak=${report.mainPathPeak === null ? 'n/a' : report.mainPathPeak.toFixed(4)}`,
    `probeSignalDetected=${report.probeSignalDetected}`,
    // 「healthy なのに聞こえない」報告のとき、残る不明点は出力先だけ（Issue #521）
    `outputDevice=${report.outputDeviceLabel ?? 'n/a'}`,
    `reason=${report.reason}`,
  ].join(' / ');
}
