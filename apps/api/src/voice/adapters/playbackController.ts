/**
 * Playback Controller — Audio output
 *
 * Phase A: Placeholder. Real implementation in Phase E.
 */

import { createLogger } from '@links/logging';

const logger = createLogger({ name: 'voice:playback' });

export interface PlaybackController {
  play(audioBuffer: Buffer): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
  setOutputDevice(deviceId: string): void;
}

export class PlaceholderPlaybackController implements PlaybackController {
  async play(_audioBuffer: Buffer): Promise<void> {
    logger.warn({ msg: 'Playback.play: NOT_IMPLEMENTED (Phase E)' });
  }

  stop(): void {
    logger.warn({ msg: 'Playback.stop: NOT_IMPLEMENTED (Phase E)' });
  }

  isPlaying(): boolean {
    return false;
  }

  setOutputDevice(_deviceId: string): void {
    logger.warn({ msg: 'Playback.setOutputDevice: NOT_IMPLEMENTED (Phase E)' });
  }
}
