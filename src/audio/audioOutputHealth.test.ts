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

describe('formatAudioHealthReport', () => {
  it('診断ログ用の一行文字列に整形できる', async () => {
    const { context, wait } = createMockContext();
    const report = await checkAudioOutputHealth(context, { wait });
    const line = formatAudioHealthReport(report);
    expect(line).toContain('verdict=healthy');
    expect(line).toContain('timeAdvancing=true');
    expect(line).toContain('signalDetected=true');
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
});
