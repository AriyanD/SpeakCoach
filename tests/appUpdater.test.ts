import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { downloadSpeakCoachUpdate, type SpeakCoachReleaseAsset } from '../src/services/appUpdater';

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    mkdir: vi.fn(),
    downloadFile: vi.fn(),
    stat: vi.fn(),
    deleteFile: vi.fn()
  }
}));

const asset: SpeakCoachReleaseAsset = {
  name: 'SpeakCoach-v1.0.6.apk',
  browser_download_url: 'https://github.com/AriyanD/SpeakCoach/releases/download/v1.0.6/SpeakCoach-v1.0.6.apk',
  size: 1234,
  sha256: 'a'.repeat(64)
};

describe('SpeakCoach update downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Filesystem.mkdir).mockResolvedValue(undefined);
    vi.mocked(Filesystem.downloadFile).mockResolvedValue({ path: '/data/user/0/app/files/SpeakCoach/updates/SpeakCoach-v1.0.6.apk' } as never);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: asset.size } as never);
    vi.mocked(Filesystem.deleteFile).mockResolvedValue(undefined);
  });

  it('creates the destination directory before downloading and verifies the APK size', async () => {
    await expect(downloadSpeakCoachUpdate(asset)).resolves.toContain('SpeakCoach-v1.0.6.apk');

    expect(Filesystem.mkdir).toHaveBeenCalledWith({
      path: 'SpeakCoach/updates',
      directory: Directory.Data,
      recursive: true
    });
    expect(Filesystem.downloadFile).toHaveBeenCalledWith({
      url: asset.browser_download_url,
      path: 'SpeakCoach/updates/SpeakCoach-v1.0.6.apk',
      directory: Directory.Data,
      recursive: true
    });
    expect(vi.mocked(Filesystem.mkdir).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(Filesystem.downloadFile).mock.invocationCallOrder[0]);
    expect(Filesystem.stat).toHaveBeenCalled();
    expect(Filesystem.deleteFile).not.toHaveBeenCalled();
  });

  it('continues downloading when the destination directory already exists', async () => {
    vi.mocked(Filesystem.mkdir).mockRejectedValue(new Error('Directory exists'));

    await expect(downloadSpeakCoachUpdate(asset)).resolves.toContain('SpeakCoach-v1.0.6.apk');

    expect(Filesystem.downloadFile).toHaveBeenCalled();
    expect(Filesystem.stat).toHaveBeenCalled();
    expect(Filesystem.deleteFile).not.toHaveBeenCalled();
  });

  it('does not hide real directory creation errors', async () => {
    const error = new Error('Permission denied');
    vi.mocked(Filesystem.mkdir).mockRejectedValue(error);

    await expect(downloadSpeakCoachUpdate(asset)).rejects.toBe(error);

    expect(Filesystem.downloadFile).not.toHaveBeenCalled();
  });

  it('deletes an incomplete APK and refuses to return its path', async () => {
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 500 } as never);

    await expect(downloadSpeakCoachUpdate(asset)).rejects.toThrow('downloaded APK is incomplete');
    expect(Filesystem.deleteFile).toHaveBeenCalledWith({
      path: 'SpeakCoach/updates/SpeakCoach-v1.0.6.apk',
      directory: Directory.Data
    });
  });

  it('removes a partial destination when the transfer itself fails', async () => {
    vi.mocked(Filesystem.downloadFile).mockRejectedValue(new Error('ENOENT'));

    await expect(downloadSpeakCoachUpdate(asset)).rejects.toThrow('ENOENT');
    expect(Filesystem.deleteFile).toHaveBeenCalled();
  });
});
