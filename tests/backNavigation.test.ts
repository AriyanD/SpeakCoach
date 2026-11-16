import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeTopmostBackLayer,
  getBackAction,
  executeRootBackAction,
  getIeltsBackAction,
  handleIeltsSessionBack,
  getSection,
  getSectionRoot,
  isSameNavigationSection,
  popPage,
  pushPage,
  resetSectionStack,
  scrollAppToTop,
  EXIT_BACK_WINDOW_MS,
  type ActiveTab,
  type NavigationSection
} from '../src/main';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('section navigation helpers', () => {
  it('maps every page to its independent section and root', () => {
    const pages: ActiveTab[] = ['home', 'shadowing', 'ielts', 'ielts-history', 'ielts-result', 'settings', 'diagnostics'];
    const expected: NavigationSection[] = ['shadowing', 'shadowing', 'ielts', 'ielts', 'ielts', 'settings', 'settings'];
    pages.forEach((page, index) => {
      expect(getSection(page)).toBe(expected[index]);
      expect(getSectionRoot(getSection(page))).toBe(expected[index]);
    });
  });

  it('pushes pages and truncates the stack when revisiting an existing page', () => {
    expect(pushPage(['ielts'], 'ielts-history')).toEqual(['ielts', 'ielts-history']);
    expect(pushPage(['ielts', 'ielts-history'], 'ielts-result')).toEqual(['ielts', 'ielts-history', 'ielts-result']);
    expect(pushPage(['ielts', 'ielts-history', 'ielts-result'], 'ielts-history')).toEqual(['ielts', 'ielts-history']);
  });

  it('pops one page but never removes the section root', () => {
    expect(popPage(['settings', 'diagnostics'])).toEqual(['settings']);
    expect(popPage(['settings'])).toEqual(['settings']);
  });

  it('resets the current view container scroll position to the top', () => {
    const view = document.createElement('main');
    Object.defineProperty(view, 'scrollTo', { value: vi.fn() });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    view.scrollTop = 240;
    scrollAppToTop(view);
    expect(view.scrollTop).toBe(0);
  });

  it('keeps bottom-tab re-tap detection within the same section', () => {
    expect(isSameNavigationSection('settings', 'settings')).toBe(true);
    expect(isSameNavigationSection('diagnostics', 'settings')).toBe(true);
    expect(isSameNavigationSection('ielts-history', 'ielts')).toBe(true);
    expect(isSameNavigationSection('ielts-result', 'ielts')).toBe(true);
    expect(isSameNavigationSection('shadowing', 'settings')).toBe(false);
  });
});

describe('Back decision flows', () => {
  it.each(['settings', 'shadowing', 'ielts'] as const)('%s root: returns to root when applicable, then hints and exits within the shared window', (root) => {
    const stack: ActiveTab[] = root === 'settings'
      ? ['settings', 'diagnostics']
      : root === 'ielts'
        ? ['ielts', 'ielts-history']
        : ['shadowing'];
    const first = getBackAction(stack, 1000, 0);
    if (stack.length > 1) {
      expect(first.type).toBe('pop');
      if (first.type === 'pop') expect(first.stack).toEqual([root]);
    } else {
      expect(first.type).toBe('hint');
    }

    const hint = getBackAction([root], 2000, 0);
    expect(hint).toEqual({ type: 'hint', timestamp: 2000 });
    const exit = getBackAction([root], 2000 + EXIT_BACK_WINDOW_MS, 2000);
    expect(exit).toEqual({ type: 'exit' });
  });

  it('shows the exit hint again after the double-Back window expires', () => {
    expect(getBackAction(['settings'], 5001, 3000)).toEqual({ type: 'hint', timestamp: 5001 });
  });

  it('calls NativeBack.exitApp on the confirmed second root Back', () => {
    const exitApp = vi.fn().mockResolvedValue(undefined);
    const showHint = vi.fn();
    const action = getBackAction(['settings'], 3000, 2000);
    executeRootBackAction(action, true, exitApp, showHint);
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(showHint).not.toHaveBeenCalled();
  });

  it('pops IELTS result → history → test menu, then shows the root hint', () => {
    let stack: ActiveTab[] = ['ielts', 'ielts-history', 'ielts-result'];
    const first = getBackAction(stack, 10, 0);
    expect(first.type).toBe('pop');
    if (first.type === 'pop') stack = first.stack;
    expect(stack).toEqual(['ielts', 'ielts-history']);
    const second = getBackAction(stack, 20, 0);
    expect(second.type).toBe('pop');
    if (second.type === 'pop') stack = second.stack;
    expect(stack).toEqual(['ielts']);
    expect(getBackAction(stack, 30, 0).type).toBe('hint');
  });

  it('keeps section stacks independent when switching tabs and never pops into another tab', () => {
    const stacks: Record<NavigationSection, ActiveTab[]> = {
      shadowing: ['shadowing'],
      ielts: ['ielts', 'ielts-history'],
      settings: ['settings', 'diagnostics']
    };
    // Selecting a different bottom tab resets only that target section.
    resetSectionStack(stacks, 'settings');
    expect(stacks.settings).toEqual(['settings']);
    expect(stacks.ielts).toEqual(['ielts', 'ielts-history']);
    const back = getBackAction(stacks.settings, 100, 0);
    expect(back.type).toBe('hint');
    expect(getSection('settings')).toBe('settings');
    expect(getSection('ielts-history')).toBe('ielts');
  });

  it('does not navigate while IELTS is evaluating; active steps require explicit confirmation', async () => {
    expect(getIeltsBackAction('evaluating')).toBe('ignore');
    for (const status of ['preparing', 'examiner_speaking', 'cue_tone', 'prep_countdown', 'recording', 'transcribing', 'unrecognized_prompt', 'error']) {
      expect(getIeltsBackAction(status)).toBe('confirm');
    }
    expect(getIeltsBackAction('idle')).toBe('continue');
    expect(getIeltsBackAction('completed')).toBe('continue');

    const cancelSession = vi.fn();
    let settleConfirmation!: (accepted: boolean) => void;
    const confirmation = new Promise<boolean>((resolve) => { settleConfirmation = resolve; });
    const pending = handleIeltsSessionBack('recording', () => confirmation, cancelSession);
    expect(cancelSession).not.toHaveBeenCalled();
    settleConfirmation(false);
    await expect(pending).resolves.toBe('kept');
    expect(cancelSession).not.toHaveBeenCalled();

    await expect(handleIeltsSessionBack('recording', async () => true, cancelSession)).resolves.toBe('cancelled');
    expect(cancelSession).toHaveBeenCalledTimes(1);
    await expect(handleIeltsSessionBack('evaluating', vi.fn(), cancelSession)).resolves.toBe('ignored');
    expect(cancelSession).toHaveBeenCalledTimes(1);
  });
});

describe('transient Back layers', () => {
  it('closes an open dialog before considering menus or routes', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);

    expect(closeTopmostBackLayer()).toBe(true);
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('collapses an expanded custom menu before returning to the previous route', () => {
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.addEventListener('click', () => trigger.setAttribute('aria-expanded', 'false'));
    document.body.append(trigger);

    expect(closeTopmostBackLayer()).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not close an open details accordion', () => {
    const details = document.createElement('details');
    details.open = true;
    document.body.append(details);

    expect(closeTopmostBackLayer()).toBe(false);
    expect(details.open).toBe(true);
  });

  it('ignores summary and accordion toggles as transient popup layers', () => {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.setAttribute('aria-expanded', 'true');
    details.append(summary);
    document.body.append(details);

    expect(closeTopmostBackLayer()).toBe(false);
    expect(details.open).toBe(true);
  });

  it('reports when there is no transient layer to dismiss', () => {
    expect(closeTopmostBackLayer()).toBe(false);
  });
});
