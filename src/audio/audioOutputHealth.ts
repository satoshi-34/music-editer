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
    // ラベルが空の項目は名前として使えないので候補から外す
    const outputs = list.filter((device) => device.kind === 'audiooutput' && !!device.label);
    if (outputs.length === 0) return null;
    // 既定デバイス（deviceId === 'default'）が「いま鳴っている先」に最も近い
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
  // 出力先デバイス名は判定そのものには使わない（表示用の補助情報）。
  // 取得に失敗しても null のまま進めて、従来どおりの判定を続ける
  const resolveLabel = options.resolveOutputDeviceLabel ?? (() => resolveAudioOutputDeviceLabel());
  const outputDeviceLabel = await resolveLabel();

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
      reason: `AudioContext が running ではない (state=${context.state})`,
      outputDeviceLabel,
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
      outputDeviceLabel,
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
      outputDeviceLabel,
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
    // 「healthy なのに聞こえない」報告のとき、残る不明点は出力先だけ（Issue #521）
    `outputDevice=${report.outputDeviceLabel ?? 'n/a'}`,
    `reason=${report.reason}`,
  ].join(' / ');
}
