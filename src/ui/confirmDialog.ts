export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'normal' | 'danger';
}

/** A small, theme-aware confirmation dialog for actions that must not be accidental. */
export function confirmInApp(options: ConfirmDialogOptions): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'sc-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    const title = document.createElement('h2');
    title.className = 'sc-dialog-title';
    title.textContent = options.title;

    const message = document.createElement('p');
    message.className = 'sc-dialog-copy';
    message.textContent = options.message;

    const actions = document.createElement('div');
    actions.className = 'sc-dialog-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = options.cancelLabel || 'Cancel';

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = options.tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
    confirm.textContent = options.confirmLabel || 'Continue';

    actions.append(cancel, confirm);
    dialog.append(title, message, actions);
    document.body.appendChild(dialog);

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    let settled = false;
    const finish = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      dialog.remove();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      resolve(accepted);
    };

    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    (options.tone === 'danger' ? cancel : confirm).focus();
  });
}
