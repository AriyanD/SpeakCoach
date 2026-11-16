import { describe, expect, it } from 'vitest';
import { confirmInApp } from '../src/ui/confirmDialog';

describe('in-app confirmation dialog', () => {
  it('resolves true when the confirm action is selected', async () => {
    const result = confirmInApp({ title: 'Confirm action', message: 'Continue?', confirmLabel: 'Continue' });
    const dialog = document.querySelector<HTMLDialogElement>('dialog.sc-dialog');
    expect(dialog).not.toBeNull();
    dialog?.querySelector<HTMLButtonElement>('.sc-dialog-actions .btn-primary')?.click();
    await expect(result).resolves.toBe(true);
    expect(document.querySelector('dialog.sc-dialog')).toBeNull();
  });

  it('resolves false when the cancel action is selected', async () => {
    const result = confirmInApp({ title: 'Confirm action', message: 'Continue?' });
    document.querySelector<HTMLButtonElement>('.sc-dialog-actions .btn-secondary')?.click();
    await expect(result).resolves.toBe(false);
    expect(document.querySelector('dialog.sc-dialog')).toBeNull();
  });

  it('focuses the safe cancel action first for dangerous dialogs and restores prior focus', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const result = confirmInApp({ title: 'Delete data?', message: 'This cannot be undone.', tone: 'danger' });
    const cancel = document.querySelector<HTMLButtonElement>('.sc-dialog-actions .btn-secondary');
    expect(document.activeElement).toBe(cancel);
    cancel?.click();
    await expect(result).resolves.toBe(false);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('resolves false when Escape is pressed', async () => {
    const result = confirmInApp({ title: 'Confirm action', message: 'Continue?' });
    const dialog = document.querySelector<HTMLDialogElement>('dialog.sc-dialog');
    const event = new Event('cancel', { cancelable: true });
    dialog?.dispatchEvent(event);
    await expect(result).resolves.toBe(false);
    expect(document.querySelector('dialog.sc-dialog')).toBeNull();
  });
});
