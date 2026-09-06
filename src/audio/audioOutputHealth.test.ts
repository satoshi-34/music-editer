// src/audio/audioOutputHealth.test.ts
// Safari silent failure 検知（issue #14）のヘルスチェック判定テスト。
// 実ブラウザの AudioContext は使えないため、判定に必要な最小限のモックを組み立てる。
import { describe, it, expect } from 'vitest';

import {
  checkAudioOutputHealth,
  formatAudioHealthReport,
  resolveAudioOutputDeviceLabel,
  describeAudioOutputDestination,
  AUDIO_OUTPUT_CHECK_HINT,
} from './audioOutputHealth';

interface MockContextConfig {
  state?: AudioContextState;
  /** wait のたびに currentTime をどれだけ進めるか（秒） */
  advancePerWait?: number;
  /** Analyser が返す波形。128 のみ＝無音 */
  analyserSample?: number;
  /** createOscillator/createAnalyser で例外を投げる（プローブ不能環境の再現） */
  failProbeSetup?: boolean;
}

function createMockContext(config: MockContextConfig = {}) {
  const {
    state = 'running',
    advancePerWait = 0.25,
    analyserSample = 200,
    failProbeSetup = false,
  } = config;

  const context = {
    state,
    currentTime: 1.0,
    createOscillator() {
      if (failProbeSetup) throw new Error('probe setup failed');
      return {
        type: 'sine',
        frequency: { value: 0 },
        connect() {},
        disconnect() {},
        start() {},
        stop() {},
      };
    },
    createAnalyser() {
      if (failProbeSetup) throw new Error('probe setup failed');
      return {
        fftSize: 0,
        frequencyBinCount: 128,
        connect() {},
        disconnect() {},
        getByteTimeDomainData(data: Uint8Array) {
          data.fill(analyserSample);
        },
      };
    },
  };

  // テストでは実時間を待たず、wait が呼ばれた瞬間に currentTime を進める
  const wait = async () => {
    context.currentTime += advancePerWait;
  };

  return { context: context as unknown as AudioContext, wait };
}

describe('checkAudioOutputHealth', () => {
  it('context が無いときは unknown（誤検知で復旧ループにしない）', async () => {
    const report = await checkAudioOutputHealth(null);
    expect(report.verdict).toBe('unknown');
    expect(report.contextState).toBe('no-context');
  });

  it('running でない context は unhealthy', async () => {
    const { context, wait } = createMockContext({ state: 'suspended' });
    const report = await checkAudioOutputHealth(context, { wait });
    expect(report.verdict).toBe('unhealthy');
    expect(report.reason).toContain('suspended');
  });

  it('running なのに currentTime が進まないときは unhealthy（Safari のレンダリング停止）', async () => {
    const { context, wait } = createMockContext({ advancePerWait: 0 });
    const report = await checkAudioOutputHealth(context, { wait });
    expect(report.verdict).toBe('unhealthy');
    expect(report.timeAdvancing).toBe(false);
  });

  it('currentTime は進むがプローブが無音（全要素 128）のときは unhealthy', async () => {
    const { context, wait } = createMockContext({ analyserSample: 128 });
    const report = await checkAudioOutputHealth(context, { wait });
    expect(report.verdict).toBe('unhealthy');
    expect(report.signalDetected).toBe(false);
  });

  it('currentTime が進みプローブで波形を観測できれば healthy', async () => {
    const { context, wait } = createMockContext();
    const report = await checkAudioOutputHealth(context, { wait });
    expect(report.verdict).toBe('healthy');
    expect(report.timeAdvancing).toBe(true);
    expect(report.signalDetected).toBe(true);
  });

  it('プローブを実施できない環境では unknown（unhealthy 扱いにしない）', async () => {
    const { context, wait } = createMockContext({ failProbeSetup: true });
    const report = await checkAudioOutputHealth(context, { wait });
    expect(report.verdict).toBe('unknown');
    expect(report.signalDetected).toBeNull();
  });
});

describe('実音経路のピークで判定する（issue #618）', () => {
  /** 指定した振幅を返す偽の実音経路 Analyser */
  function createMainPathAnalyser(amplitude: number): AnalyserNode {
    return {
      fftSize: 4,
      getFloatTimeDomainData(data: Float32Array) {
        data.fill(0);
        data[0] = amplitude;
      },
    } as unknown as AnalyserNode;
  }

  it('実音経路が無音なら、プローブが有音でも unhealthy（従来はここで healthy と誤報告していた）', async () => {
    const { context, wait } = createMockContext({ analyserSample: 200 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
    });
    expect(report.verdict).toBe('unhealthy');
    expect(report.mainPathSilent).toBe(true);
    expect(report.signalDetected).toBe(false);
    // プローブ自体は波形を観測できている＝別経路なので当てにならない、を記録に残す
    expect(report.probeSignalDetected).toBe(true);
    expect(report.reason).toContain('実音経路');
  });

  it('実音経路に信号があれば、プローブが無音でも healthy', async () => {
    const { context, wait } = createMockContext({ analyserSample: 128 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0.04),
    });
    expect(report.verdict).toBe('healthy');
    expect(report.mainPathSilent).toBe(false);
    expect(report.mainPathPeak).toBeCloseTo(0.04, 5);
  });

  it('発音直後に観測しておいたピークも判定に使う（短い音が鳴り終わっていても healthy）', async () => {
    const { context, wait } = createMockContext();
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
      observedMainPathPeak: 0.2,
    });
    expect(report.verdict).toBe('healthy');
    expect(report.mainPathPeak).toBeCloseTo(0.2, 5);
  });

  it('無音が正常なとき（音量 0・休符だけの譜面）は実音経路で判定しない', async () => {
    const { context, wait } = createMockContext({ analyserSample: 200 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
      silenceIsExpected: true,
    });
    expect(report.verdict).toBe('healthy');
    expect(report.mainPathSilent).toBe(false);
  });

  it('音量スライダーを絞っているだけの正常なタブを「壊れています」と言わない（round1 P1-2）', async () => {
    // 音量 20% → gain 0.16。正常なタブのピーク（0.006）も 0.16 倍の 0.00096 まで縮み、
    // 固定しきい値 0.001 のままだと正常な音が「無音」に見えていた
    const { context, wait } = createMockContext({ analyserSample: 128 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0.00096),
      masterGain: 0.16,
    });
    expect(report.verdict).toBe('healthy');
    expect(report.mainPathSilent).toBe(false);
  });

  it('音量を絞っていても、完全な無音（ピーク 0）なら壊れていると判定できる（round1 P1-2）', async () => {
    const { context, wait } = createMockContext({ analyserSample: 200 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
      masterGain: 0.16,
    });
    expect(report.verdict).toBe('unhealthy');
    expect(report.mainPathSilent).toBe(true);
  });

  it('音量をほぼ 0 まで絞っているときは実音経路で判定しない（round1 P1-2）', async () => {
    const { context, wait } = createMockContext({ analyserSample: 200 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
      masterGain: 0.004,
    });
    // プローブ（別経路）は有音なので、従来どおりの判定に落ちる
    expect(report.verdict).toBe('healthy');
    expect(report.mainPathSilent).toBe(false);
  });

  it('8bit でしか読めない Analyser では実音経路で判定しない（round1 P3・量子化で 0 に丸まる）', async () => {
    const { context, wait } = createMockContext({ analyserSample: 200 });
    // getFloatTimeDomainData を持たない＝1 目盛 1/128 ≒ 0.0078 でしか測れない
    const byteOnlyAnalyser = {
      fftSize: 4,
      getByteTimeDomainData(data: Uint8Array) { data.fill(128); },
    } as unknown as AnalyserNode;
    const report = await checkAudioOutputHealth(context, { wait, mainPathAnalyser: byteOnlyAnalyser });
    expect(report.mainPathSilent).toBe(false);
    expect(report.verdict).toBe('healthy');
  });

  it('currentTime が進まないときは「タブの音声経路が壊れている」にしない（round1 P1-3・Safari の自動復旧を残す）', async () => {
    // レンダリングが止まれば実音経路の Analyser も 0 になるが、これは従来
    // エンジンの作り直しで直っていたケース。mainPathSilent にすると復旧が走らなくなる
    const { context, wait } = createMockContext({ advancePerWait: 0, analyserSample: 200 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
    });
    expect(report.verdict).toBe('unhealthy');
    expect(report.mainPathSilent).toBe(false);
    expect(report.reason).toContain('レンダリング停止');
  });

  it('補助プローブも無音のときは「タブが壊れている」にしない（round1 P1-3・グラフ全体の死は復旧対象）', async () => {
    const { context, wait } = createMockContext({ analyserSample: 128 });
    const report = await checkAudioOutputHealth(context, {
      wait,
      mainPathAnalyser: createMainPathAnalyser(0),
    });
    expect(report.verdict).toBe('unhealthy');
    expect(report.mainPathSilent).toBe(false);
    expect(report.reason).toContain('グラフ処理が死んでいる');
  });

  it('Analyser が無い環境では従来どおりプローブで判定する（機能劣化なし）', async () => {
    const { context, wait } = createMockContext({ analyserSample: 128 });
    const report = await checkAudioOutputHealth(context, { wait });
    expect(report.verdict).toBe('unhealthy');
    expect(report.mainPathPeak).toBeNull();
    expect(report.mainPathSilent).toBe(false);
  });
});

describe('formatAudioHealthReport', () => {
  it('診断ログ用の一行文字列に整形できる', async () => {
    const { context, wait } = createMockContext();
    const report = await checkAudioOutputHealth(context, { wait });
    const line = formatAudioHealthReport(report);
    expect(line).toContain('verdict=healthy');
    expect(line).toContain('timeAdvancing=true');
    expect(line).toContain('signalDetected=true');
    // 切り分けを1行で済ませるための実測値（issue #618）
    expect(line).toContain('mainPathPeak=');
  });
});

// Issue #521: 「アプリは信号を出しているのに聞こえない」ときに残る不明点は出力先だけなので、
// 診断結果に出力先デバイス名と次の一手（OS の出力先を見る）を含める。
describe('出力先デバイス名（Issue #521）', () => {
  /** enumerateDevices を差し替えた MediaDevices もどきを作る */
  function createMockMediaDevices(devices: Partial<MediaDeviceInfo>[] | Error) {
    return {
      enumerateDevices: async () => {
        if (devices instanceof Error) throw devices;
        return devices as MediaDeviceInfo[];
      },
    } as unknown as MediaDevices;
  }

  it('audiooutput の既定デバイス名を返す', async () => {
    const label = await resolveAudioOutputDeviceLabel(createMockMediaDevices([
      { kind: 'audioinput', deviceId: 'default', label: 'MacBook Pro のマイク' },
      { kind: 'audiooutput', deviceId: 'abc', label: 'MacBook Pro のスピーカー' },
      { kind: 'audiooutput', deviceId: 'default', label: 'LG UltraFine Display' },
    ]));
    // deviceId === 'default' が「いま鳴っている先」に最も近いので優先する
    expect(label).toBe('LG UltraFine Display');
  });

  it('既定デバイスが無ければ先頭の audiooutput を使う', async () => {
    const label = await resolveAudioOutputDeviceLabel(createMockMediaDevices([
      { kind: 'audiooutput', deviceId: 'abc', label: '外部ヘッドホン' },
    ]));
    expect(label).toBe('外部ヘッドホン');
  });

  it('ラベルが空（権限なし）のときは null（受入2・機能劣化なし）', async () => {
    const label = await resolveAudioOutputDeviceLabel(createMockMediaDevices([
      { kind: 'audiooutput', deviceId: 'default', label: '' },
    ]));
    expect(label).toBeNull();
  });

  it('API 非対応環境では null を返す（例外にしない）', async () => {
    expect(await resolveAudioOutputDeviceLabel(null)).toBeNull();
    expect(await resolveAudioOutputDeviceLabel({} as unknown as MediaDevices)).toBeNull();
  });

  it('enumerateDevices が失敗しても null を返して診断を止めない', async () => {
    const label = await resolveAudioOutputDeviceLabel(createMockMediaDevices(new Error('denied')));
    expect(label).toBeNull();
  });

  it('ヘルスチェックの結果にデバイス名が入る（受入1）', async () => {
    const { context, wait } = createMockContext();
    const report = await checkAudioOutputHealth(context, {
      wait,
      resolveOutputDeviceLabel: async () => 'LG UltraFine Display',
    });
    expect(report.outputDeviceLabel).toBe('LG UltraFine Display');
    expect(formatAudioHealthReport(report)).toContain('outputDevice=LG UltraFine Display');
  });

  it('デバイス名を取得できなくても判定は従来どおり（受入2・回帰）', async () => {
    const { context, wait } = createMockContext();
    const report = await checkAudioOutputHealth(context, {
      wait,
      resolveOutputDeviceLabel: async () => null,
    });
    expect(report.verdict).toBe('healthy');
    expect(report.outputDeviceLabel).toBeNull();
    expect(formatAudioHealthReport(report)).toContain('outputDevice=n/a');
  });

  it('案内文はデバイス名の有無どちらでも「出力先を確認」を含む（受入1）', async () => {
    const { context, wait } = createMockContext();
    const withDevice = await checkAudioOutputHealth(context, {
      wait,
      resolveOutputDeviceLabel: async () => 'LG UltraFine Display',
    });
    const withoutDevice = await checkAudioOutputHealth(context, {
      wait,
      resolveOutputDeviceLabel: async () => null,
    });

    expect(describeAudioOutputDestination(withDevice)).toContain('現在の出力先: LG UltraFine Display');
    expect(describeAudioOutputDestination(withDevice)).toContain(AUDIO_OUTPUT_CHECK_HINT);
    // 取得できない環境ではデバイス名を省略し、案内文だけにする
    expect(describeAudioOutputDestination(withoutDevice)).toBe(AUDIO_OUTPUT_CHECK_HINT);
    expect(describeAudioOutputDestination(withoutDevice)).not.toContain('現在の出力先');
  });

  it('既定デバイスのラベルだけ空なら null（別デバイスを誤表示しない・round1 P2）', async () => {
    const devices = {
      enumerateDevices: async () => [
        { kind: 'audiooutput', deviceId: 'default', label: '' },
        { kind: 'audiooutput', deviceId: 'hdmi-1', label: '外部モニター' },
      ],
    } as unknown as MediaDevices;
    expect(await resolveAudioOutputDeviceLabel(devices)).toBeNull();
  });

  it('resolveOutputDeviceLabel が reject しても判定は従来どおり返る（round1 P3）', async () => {
    const context = null;
    const report = await checkAudioOutputHealth(context, {
      resolveOutputDeviceLabel: () => Promise.reject(new Error('boom')),
    });
    expect(report.verdict).toBe('unknown');
    expect(report.outputDeviceLabel).toBeNull();
  });
});

describe('MAIN_PATH_SILENCE_THRESHOLD（#618 round2 P1: pp＋ローパスでも有音）', () => {
  it('pp 単音相当のピーク（0.0005）は無音扱いにならず、厳密な 0 だけが無音', async () => {
    const { MAIN_PATH_SILENCE_THRESHOLD } = await import('./audioOutputHealth');
    expect(0.0005).toBeGreaterThan(MAIN_PATH_SILENCE_THRESHOLD);
    expect(0).toBeLessThan(MAIN_PATH_SILENCE_THRESHOLD);
  });
});
