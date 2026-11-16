import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeBackupFile {
  fileName: string;
  contents: string;
  uri: string;
  bytesRead: number;
}

interface BackupImportPlugin {
  selectFile(): Promise<NativeBackupFile>;
}

const NativeBackupImport = registerPlugin<BackupImportPlugin>('BackupImport');

export function isNativeBackupImportAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Opens Android's Storage Access Framework picker and reads the selected
 * document through ContentResolver, avoiding WebView File/FileReader quirks.
 */
export async function selectNativeBackupFile(): Promise<NativeBackupFile> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native backup import is only available in the Android app.');
  }
  const selected = await NativeBackupImport.selectFile();
  if (!selected || typeof selected.contents !== 'string') {
    throw new Error('Android did not return the selected backup contents.');
  }
  if (!selected.contents.trim()) {
    throw new Error(
      `The selected file "${selected.fileName || 'backup'}" contains no readable text (${selected.bytesRead || 0} bytes). Choose the exported SpeakCoach JSON backup.`
    );
  }
  return selected;
}
