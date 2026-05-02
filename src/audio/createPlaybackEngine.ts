import type { PlaybackEngine } from './PlaybackEngine';
import { SimpleAudioEngine } from './SimpleAudioEngine';
import { SoundFontEngine, resolveSoundFontName } from './SoundFontEngine';
import type { PlaybackSoundRuntimeSettings } from './playbackSettings';

/**
 * UI 設定に応じて、実際に使う再生エンジンを作る。
 * plugin はまだ将来拡張なので、今は安全側として内蔵音源へフォールバックする。
 */
export function createPlaybackEngine(
  settings: PlaybackSoundRuntimeSettings
): PlaybackEngine {
  if (settings.engineMode === 'soundfont') {
    return new SoundFontEngine(resolveSoundFontName(settings.pluginName));
  }

  return new SimpleAudioEngine();
}
