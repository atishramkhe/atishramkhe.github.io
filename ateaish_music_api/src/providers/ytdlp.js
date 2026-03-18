import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class YtDlpProvider {
  constructor({ enabled, binaryPath }) {
    this.enabled = enabled;
    this.binaryPath = binaryPath;
  }

  get status() {
    return this.enabled ? 'enabled' : 'disabled';
  }

  async inspectVideo(videoId) {
    if (!this.enabled || !videoId) return null;
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
      const { stdout } = await execFileAsync(this.binaryPath, ['--dump-single-json', '--no-playlist', url], {
        timeout: 15000,
        maxBuffer: 1024 * 1024
      });
      const payload = JSON.parse(stdout);
      return {
        id: payload.id,
        title: payload.title || '',
        durationMs: Number(payload.duration || 0) * 1000,
        uploader: payload.uploader || ''
      };
    } catch (error) {
      console.warn('yt-dlp inspection failed:', error.message);
      return null;
    }
  }

  async validateMapping(spotifyId, videoId) {
    if (!spotifyId || !videoId) return false;
    const inspection = await this.inspectVideo(videoId);
    return Boolean(inspection?.id);
  }
}