import { Capacitor, registerPlugin } from '@capacitor/core';

interface BackupExportPlugin {
  saveFile(options: { fileName: string; contents: string }): Promise<{ uri: string; saved: boolean }>;
}

const NativeBackupExport = registerPlugin<BackupExportPlugin>('BackupExport');

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description?: string; accept: Record<string, string[]> }>;
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export async function saveBackupFile(fileName: string, contents: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await NativeBackupExport.saveFile({ fileName, contents });
    return;
  }

  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    const handle = await picker.call(window, {
      suggestedName: fileName,
      types: [{ description: 'SpeakCoach JSON backup', accept: { 'application/json': ['.json'] } }]
    });
    const writable = await handle.createWritable();
    await writable.write(new Blob([contents], { type: 'application/json' }));
    await writable.close();
    return;
  }

  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
