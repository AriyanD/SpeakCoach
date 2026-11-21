import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { APP_VERSION } from '../config/appVersion';

const OWNER = 'AriyanD';
const REPOSITORY = 'SpeakCoach';
const LATEST_RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`;

export interface SpeakCoachReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
  sha256: string;
}

export interface SpeakCoachUpdate {
  version: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string | null;
  asset: SpeakCoachReleaseAsset;
}

interface UpdateInstallerPlugin {
  getAndroidSdkInt(): Promise<{ sdkInt: number }>;
  installApk(options: { path: string; sha256: string }): Promise<{ permissionRequired: boolean }>;
}

const UpdateInstaller = registerPlugin<UpdateInstallerPlugin>('UpdateInstaller');

export function assertMinimumAndroidSdk(sdkInt: number): void {
  if (!Number.isInteger(sdkInt) || sdkInt < 1) {
    throw new Error('SpeakCoach could not verify this device’s Android version. Update checking and installation have been stopped for safety.');
  }
  if (sdkInt < 23) {
    throw new Error(`This update requires Android 6.0 (API 23) or newer. This device reports API ${sdkInt}; Android 5.1 and older are not supported.`);
  }
}

async function assertSupportedAndroidDevice(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  const device = await UpdateInstaller.getAndroidSdkInt();
  assertMinimumAndroidSdk(device.sdkInt);
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) throw new Error('The release version is not a valid semantic version.');
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

export async function checkForSpeakCoachUpdate(): Promise<SpeakCoachUpdate | null> {
  await assertSupportedAndroidDevice();
  const response = await fetch(LATEST_RELEASE_API, {
    method: 'GET',
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store'
  });

  if (response.status === 404) throw new Error('No public SpeakCoach release has been published yet.');
  if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}). Please try again later.`);

  const release = await response.json() as {
    tag_name?: string;
    html_url?: string;
    body?: string | null;
    published_at?: string | null;
    draft?: boolean;
    prerelease?: boolean;
    assets?: Array<{
      name?: string;
      browser_download_url?: string;
      size?: number;
      content_type?: string;
      digest?: string | null;
    }>;
  };

  const version = String(release.tag_name ?? '').replace(/^v/i, '');
  if (!version || release.draft || release.prerelease || !isNewerVersion(version, APP_VERSION)) return null;

  const asset = (release.assets ?? []).find((item) =>
    item.name === `SpeakCoach-v${version}.apk`
    && typeof item.browser_download_url === 'string'
    && item.browser_download_url.startsWith('https://github.com/')
  );
  if (!asset?.name || !asset.browser_download_url || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? '')) {
    throw new Error('A newer release exists, but its installable SpeakCoach APK is not attached yet.');
  }

  return {
    version,
    releaseUrl: String(release.html_url ?? `https://github.com/${OWNER}/${REPOSITORY}/releases/latest`),
    releaseNotes: String(release.body ?? '').trim(),
    publishedAt: release.published_at ?? null,
    asset: {
      name: asset.name,
      browser_download_url: asset.browser_download_url,
      size: Number(asset.size ?? 0),
      sha256: String(asset.digest).slice('sha256:'.length)
    }
  };
}

export async function downloadSpeakCoachUpdate(asset: SpeakCoachReleaseAsset): Promise<string> {
  const directoryPath = 'SpeakCoach/updates';
  const filePath = `${directoryPath}/${asset.name}`;

  // Ensure the destination exists without failing when a previous attempt
  // (or an earlier download) has already created it. Only suppress the
  // specific "already exists" condition; permission and storage errors must
  // still stop the download.
  try {
    await Filesystem.mkdir({
      path: directoryPath,
      directory: Directory.Data,
      recursive: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/directory\s+exists|already\s+exists/i.test(message)) throw error;
  }

  try {
    const result = await Filesystem.downloadFile({
      url: asset.browser_download_url,
      path: filePath,
      directory: Directory.Data,
      recursive: true
    });
    if (!result.path) throw new Error('The APK download completed without a local file path.');

    // Never offer a truncated download to the package installer.
    const downloaded = await Filesystem.stat({ path: filePath, directory: Directory.Data });
    if (asset.size > 0 && downloaded.size !== asset.size) {
      throw new Error(`The downloaded APK is incomplete (${downloaded.size} of ${asset.size} bytes). Please try again.`);
    }
    return result.path;
  } catch (error) {
    // A failed transfer may leave a partial file at the final destination.
    // Remove it so a later attempt always starts cleanly.
    try {
      await Filesystem.deleteFile({ path: filePath, directory: Directory.Data });
    } catch {
      // The file may not have been created.
    }
    throw error;
  }
}

export async function installSpeakCoachUpdate(path: string, sha256: string): Promise<boolean> {
  await assertSupportedAndroidDevice();
  const result = await UpdateInstaller.installApk({ path, sha256 });
  return result.permissionRequired;
}
