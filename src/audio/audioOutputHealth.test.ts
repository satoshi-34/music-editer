// src/audio/audioOutputHealth.test.ts
// Safari silent failure 検知（issue #14）のヘルスチェック判定テスト。
// 実ブラウザの AudioContext は使えないため、判定に必要な最小限のモックを組み立てる。
import { describe, it, expect } from 'vitest';

import { checkAudioOutputHealth, formatAudioHealthReport } from './audioOutputHealth';

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
