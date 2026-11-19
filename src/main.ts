import { APP_VERSION } from './config/appVersion';
import { Capacitor, registerPlugin } from '@capacitor/core';

import { networkMonitor } from './services/networkMonitor';
import { resolveGlobalTierSummary } from './services/tierManager';
import { loadAllSlotsConfig } from './storage/localStore';
import { clearDiagnosticsCache, renderDiagnosticsView } from './ui/DiagnosticsView';
import { renderSettingsView } from './ui/SettingsView';
import { renderShadowingView, resetShadowingViewState, pauseShadowingRecordingForBackground } from './ui/ShadowingView';
import { renderIeltsView } from './ui/IeltsView';
import { renderIeltsResultView } from './ui/IeltsResultView';
import { renderIeltsHistoryView } from './ui/IeltsHistoryView';
import { ieltsSessionEngine } from './services/ieltsSessionEngine';
import { stopAllTts } from './services/ttsService';
import { audioRecorder } from './services/audioRecorder';
import { initializeTheme } from './services/themeManager';
import { initializeAppLanguage, observeAppLanguage } from './services/appLanguage';
import { runFirstLaunchOnboarding } from './ui/OnboardingView';
import { confirmInApp } from './ui/confirmDialog';
import { showToast } from './ui/toast';
import { loadSelectedShadowingLanguage } from './services/shadowingLanguageHistory';
import type { IeltsTestRecord } from './storage/ieltsHistoryStore';

interface NativeBackPlugin {
  exitApp(): Promise<void>;
}

const NativeBack = registerPlugin<NativeBackPlugin>('NativeBack');

export type ActiveTab =
  | 'home'
  | 'shadowing'
  | 'ielts'
  | 'ielts-result'
  | 'ielts-history'
  | 'settings'
  | 'diagnostics';

export type NavigationSection = 'shadowing' | 'ielts' | 'settings';

export function getSection(page: ActiveTab): NavigationSection {
  if (page === 'ielts' || page === 'ielts-history' || page === 'ielts-result') return 'ielts';
  if (page === 'settings' || page === 'diagnostics') return 'settings';
  return 'shadowing';
}

export function getSectionRoot(section: NavigationSection): ActiveTab {
  return section;
}

export type SectionStacks = Record<NavigationSection, ActiveTab[]>;

export function resetSectionStack(stacks: SectionStacks, section: NavigationSection): void {
  stacks[section] = [getSectionRoot(section)];
}

/** Push a page within one section; revisiting an existing page truncates forward history. */
export function pushPage(stack: ActiveTab[], page: ActiveTab): ActiveTab[] {
  const existingIndex = stack.lastIndexOf(page);
  return existingIndex >= 0 ? stack.slice(0, existingIndex + 1) : [...stack, page];
}

/** Pop one in-section page while never removing its root. */
export function popPage(stack: ActiveTab[]): ActiveTab[] {
  return stack.length > 1 ? stack.slice(0, -1) : [...stack];
}

export const EXIT_BACK_WINDOW_MS = 2000;

export type BackAction = { type: 'pop'; stack: ActiveTab[] } | { type: 'hint'; timestamp: number } | { type: 'exit' };

export function getBackAction(stack: ActiveTab[], now: number, lastRootBackAt: number): BackAction {
  if (stack.length > 1) return { type: 'pop', stack: popPage(stack) };
  if (lastRootBackAt > 0 && now - lastRootBackAt <= EXIT_BACK_WINDOW_MS) return { type: 'exit' };
  return { type: 'hint', timestamp: now };
}

export function executeRootBackAction(
  action: BackAction,
  isNative: boolean,
  exitApp: () => Promise<void>,
  showHint: () => void
): void {
  if (action.type === 'exit' && isNative) {
    void exitApp().catch(showHint);
    return;
  }
  showHint();
}

export function getIeltsBackAction(status: string): 'ignore' | 'confirm' | 'continue' {
  if (status === 'evaluating') return 'ignore';
  if (status === 'idle' || status === 'completed') return 'continue';
  return 'confirm';
}

export async function handleIeltsSessionBack(
  status: string,
  confirm: () => Promise<boolean>,
  cancel: () => void
): Promise<'ignored' | 'continue' | 'cancelled' | 'kept'> {
  const action = getIeltsBackAction(status);
  if (action === 'ignore') return 'ignored';
  if (action === 'continue') return 'continue';
  const confirmed = await confirm();
  if (confirmed) {
    cancel();
    return 'cancelled';
  }
  return 'kept';
}

export function getAppVersion(): string {
  return APP_VERSION;
}

export function isSameNavigationSection(currentTab: ActiveTab, targetTab: ActiveTab): boolean {
  if (currentTab === targetTab) return true;
  if (targetTab === 'ielts') return currentTab === 'ielts-result' || currentTab === 'ielts-history';
  if (targetTab === 'settings') return currentTab === 'diagnostics';
  return false;
}

export function scrollAppToTop(viewContainer?: HTMLElement | null): void {
  try {
    window.scrollTo({ top: 0, behavior: 'auto' });
  } catch {
    try { window.scrollTo(0, 0); } catch { /* Ignore unsupported embedded-view scroll APIs. */ }
  }
  if (viewContainer) {
    try { viewContainer.scrollTo({ top: 0, behavior: 'auto' }); } catch {
      viewContainer.scrollTop = 0;
    }
    viewContainer.scrollTop = 0;
  }
}

/** Close the highest-priority transient UI layer before changing the app route. */
export function closeTopmostBackLayer(): boolean {
  if (typeof document === 'undefined') return false;

  const openDialogs = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
  const dialog = openDialogs[openDialogs.length - 1];
  if (dialog) {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    if (dialog.isConnected && dialog.open) {
      if (typeof dialog.close === 'function') {
        try { dialog.close(); } catch { dialog.removeAttribute('open'); }
      } else {
        dialog.removeAttribute('open');
      }
    }
    return true;
  }

  const expandedTriggers = Array.from(document.querySelectorAll<HTMLElement>('[aria-expanded="true"]'))
    .filter((element) => !element.closest('.bottom-nav') && !element.closest('details, summary'));
  const expandedTrigger = expandedTriggers[expandedTriggers.length - 1];
  if (expandedTrigger) {
    expandedTrigger.click();
    return true;
  }


  return false;
}

export async function bootstrapApp(
  root: HTMLElement,
  initialTab: ActiveTab = 'shadowing'
): Promise<void> {
  let currentTab: ActiveTab = initialTab === 'home' ? 'shadowing' : initialTab;
  // Declare before any navigation closures capture this state.
  let lastRootBackAt = 0;
  const sectionStacks: Record<NavigationSection, ActiveTab[]> = {
    shadowing: ['shadowing'],
    ielts: ['ielts'],
    settings: ['settings']
  };
  if (currentTab !== getSectionRoot(getSection(currentTab))) {
    const section = getSection(currentTab);
    sectionStacks[section] = pushPage(sectionStacks[section], currentTab);
  }
  let activeIeltsResult: IeltsTestRecord | null = null;
  let activeCleanup: (() => void) | null = null;
  let refreshGeneration = 0;
  let lifecyclePauseInProgress = false;

  clearDiagnosticsCache();
  resetShadowingViewState();
  await initializeTheme();
  await runFirstLaunchOnboarding();
  await initializeAppLanguage();

  root.innerHTML = `
    <main class="view-container" id="view-container"></main>
    <nav class="bottom-nav" aria-label="Main navigation">
      <button type="button" class="nav-btn" id="nav-shadowing"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3m-4 0h8"/></svg><span>Shadowing</span></button>
      <button type="button" class="nav-btn" id="nav-ielts"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8M8 10h6"/></svg><span>IELTS Test</span></button>
      <button type="button" class="nav-btn" id="nav-settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1)"/></svg><span>Settings</span></button>
    </nav>
  `;

  observeAppLanguage(document.body);

  const viewContainer = root.querySelector<HTMLElement>('#view-container');
  const navShadowingBtn = root.querySelector<HTMLButtonElement>('#nav-shadowing');
  const navIeltsBtn = root.querySelector<HTMLButtonElement>('#nav-ielts');
  const navSettingsBtn = root.querySelector<HTMLButtonElement>('#nav-settings');

  const navigateTo = (page: ActiveTab): void => {
    if (page === currentTab) return;
    const currentSection = getSection(currentTab);
    const targetSection = getSection(page);
    if (currentSection !== targetSection) {
      // Cross-section navigation behaves like selecting that tab: start at its root.
      resetSectionStack(sectionStacks, targetSection);
      currentTab = getSectionRoot(targetSection);
    } else {
      sectionStacks[targetSection] = pushPage(sectionStacks[targetSection], page);
      currentTab = page;
    }
    lastRootBackAt = 0;
    void refreshUI().then(() => scrollAppToTop(viewContainer));
  };

  const resetSectionToRoot = (section: NavigationSection): void => {
    resetSectionStack(sectionStacks, section);
    currentTab = getSectionRoot(section);
    lastRootBackAt = 0;
    void refreshUI().then(() => scrollAppToTop(viewContainer));
  };

  const goBackTo = (page: ActiveTab): void => {
    const section = getSection(currentTab);
    if (getSection(page) === section) {
      const stack = sectionStacks[section];
      const index = stack.lastIndexOf(page);
      sectionStacks[section] = index >= 0
        ? stack.slice(0, index + 1)
        : pushPage([getSectionRoot(section)], page);
      currentTab = page;
      lastRootBackAt = 0;
      void refreshUI().then(() => scrollAppToTop(viewContainer));
      return;
    }
    navigateTo(page);
  };

  const refreshUI = async (): Promise<void> => {
    if (!viewContainer) return;
    const generation = ++refreshGeneration;

    const configs = await loadAllSlotsConfig();
    const summary = await resolveGlobalTierSummary(configs);
    // A slower refresh must never overwrite a newer route or network state.
    if (generation !== refreshGeneration) return;

    // Run cleanup only after the latest refresh has finished loading its data.
    if (activeCleanup) {
      activeCleanup();
      activeCleanup = null;
    }


    navShadowingBtn?.classList.toggle('active', currentTab === 'shadowing');
    navIeltsBtn?.classList.toggle(
      'active',
      currentTab === 'ielts' || currentTab === 'ielts-result' || currentTab === 'ielts-history'
    );
    navSettingsBtn?.classList.toggle('active', currentTab === 'settings' || currentTab === 'diagnostics');

    if (currentTab === 'shadowing') {
      activeCleanup = renderShadowingView(viewContainer, summary);
    } else if (currentTab === 'ielts') {
      activeCleanup = renderIeltsView(viewContainer, summary, {
        onComplete: (record) => {
          activeIeltsResult = record;
          navigateTo('ielts-result');
        },
        onViewHistory: () => {
          goBackTo('ielts-history');
        },
        onOpenSettings: () => navigateTo('settings')
      });
    } else if (currentTab === 'ielts-result' && activeIeltsResult) {
      renderIeltsResultView(viewContainer, activeIeltsResult, {
        onRetake: () => {
          stopAllTts();
          ieltsSessionEngine.reset();
          activeIeltsResult = null;
          goBackTo('ielts');
        },
        onReturnToMenu: () => {
          stopAllTts();
          ieltsSessionEngine.reset();
          activeIeltsResult = null;
          navigateTo('shadowing');
        },
        onBackToHistory: () => {
          stopAllTts();
          ieltsSessionEngine.reset();
          goBackTo('ielts-history');
        }
      });
    } else if (currentTab === 'ielts-history') {
      activeCleanup = await renderIeltsHistoryView(viewContainer, {
        onSelectResult: (record) => {
          activeIeltsResult = record;
          navigateTo('ielts-result');
        },
        onBackToTest: () => {
          ieltsSessionEngine.reset();
          goBackTo('ielts');
        },
        onRepeatTest: (record) => {
          if (!record.plan) return;
          stopAllTts();
          void (async () => {
            await ieltsSessionEngine.startSession(record.mode, { plan: record.plan, allowHistoricalPlan: true });
            activeIeltsResult = null;
            navigateTo('ielts');
          })();
        }
      });
    } else if (currentTab === 'settings') {
      await renderSettingsView(viewContainer, configs, summary, async () => {
        clearDiagnosticsCache();
        await refreshUI();
      }, () => {
        navigateTo('diagnostics');
      });
    } else {
      await renderDiagnosticsView(viewContainer, getAppVersion(), refreshUI);
    }
  };

  const handleBottomNavTap = async (tab: ActiveTab): Promise<void> => {
    if (tab === 'ielts') {
      const practiceLanguage = await loadSelectedShadowingLanguage();
      if (practiceLanguage !== 'en') {
        showToast('IELTS practice is available only when Shadowing practice language is set to English. Switch to English in Shadowing first.', 'info');
        return;
      }
    }
    const section = getSection(tab);
    if (isSameNavigationSection(currentTab, tab)) {
      scrollAppToTop(viewContainer);
      return;
    }

    // Moving from an active IELTS session to another bottom tab is equivalent
    // to pressing Back: preserve the draft unless the user confirms quitting.
    if (getSection(currentTab) === 'ielts' && section !== 'ielts') {
      const status = ieltsSessionEngine.getSnapshot().status;
      const action = getIeltsBackAction(status);
      if (action === 'ignore') return;
      if (action === 'confirm') {
        if (quitDialogOpen) return;
        quitDialogOpen = true;
        void handleIeltsSessionBack(
          status,
          () => confirmInApp({
            title: 'Quit this test?',
            message: 'Your answers saved so far will remain in the session history. You can return to this test later.',
            confirmLabel: 'Quit test',
            cancelLabel: 'Keep practising',
            tone: 'danger'
          }),
          () => ieltsSessionEngine.cancelSession()
        ).then((result) => {
          if (result === 'cancelled') resetSectionToRoot(section);
        }).finally(() => {
          quitDialogOpen = false;
        });
        return;
      }
    }
    resetSectionToRoot(section);
  };

  navShadowingBtn?.addEventListener('click', () => { void handleBottomNavTap('shadowing'); });
  navIeltsBtn?.addEventListener('click', () => { void handleBottomNavTap('ielts'); });
  navSettingsBtn?.addEventListener('click', () => { void handleBottomNavTap('settings'); });

  let exitHintTimer: number | undefined;
  let quitDialogOpen = false;

  const showExitHint = (): void => {
    let hint = document.getElementById('speakcoach-exit-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'speakcoach-exit-hint';
      hint.setAttribute('role', 'status');
      hint.setAttribute('aria-live', 'polite');
      hint.textContent = 'Press back again to exit.';
      Object.assign(hint.style, {
        position: 'fixed', left: '50%', bottom: '88px', transform: 'translateX(-50%)',
        zIndex: '10000', maxWidth: 'calc(100vw - 32px)', padding: '10px 16px',
        borderRadius: '12px', background: 'var(--bg-elevated, #26332b)',
        color: 'var(--text-primary, #fff)', border: '1px solid var(--border, #526056)',
        boxShadow: '0 4px 18px rgba(0,0,0,.22)', fontSize: '14px',
        textAlign: 'center', pointerEvents: 'none'
      });
      document.body.appendChild(hint);
    }
    if (exitHintTimer !== undefined) window.clearTimeout(exitHintTimer);
    exitHintTimer = window.setTimeout(() => hint?.remove(), EXIT_BACK_WINDOW_MS);
  };

  const handleRootBack = (): void => {
    const section = getSection(currentTab);
    const action = getBackAction(sectionStacks[section], Date.now(), lastRootBackAt);
    if (action.type === 'pop') {
      sectionStacks[section] = action.stack;
      currentTab = action.stack[action.stack.length - 1];
      lastRootBackAt = 0;
      void refreshUI().then(() => scrollAppToTop(viewContainer));
      return;
    }
    if (action.type === 'exit') {
      lastRootBackAt = 0;
      executeRootBackAction(action, Capacitor.isNativePlatform(), () => NativeBack.exitApp(), showExitHint);
      return;
    }
    lastRootBackAt = action.timestamp;
    showExitHint();
  };

  const handleSystemBack = (): void => {
    if (closeTopmostBackLayer()) {
      lastRootBackAt = 0;
      return;
    }

    const section = getSection(currentTab);
    if (section === 'ielts') {
      const status = ieltsSessionEngine.getSnapshot().status;
      const sessionBackAction = getIeltsBackAction(status);
      if (sessionBackAction === 'ignore') {
        lastRootBackAt = 0;
        return;
      }
      if (sessionBackAction === 'confirm') {
        lastRootBackAt = 0;
        if (!quitDialogOpen) {
          quitDialogOpen = true;
          void handleIeltsSessionBack(
            status,
            () => confirmInApp({
              title: 'Quit this test?',
              message: 'Your answers saved so far will remain in the session history. You can return to the question library.',
              confirmLabel: 'Quit test',
              cancelLabel: 'Keep practising',
              tone: 'danger'
            }),
            () => ieltsSessionEngine.cancelSession()
          ).finally(() => {
            quitDialogOpen = false;
          });
        }
        return;
      }
    }

    const stack = sectionStacks[section];
    if (stack.length > 1) {
      sectionStacks[section] = popPage(stack);
      currentTab = sectionStacks[section][sectionStacks[section].length - 1];
      lastRootBackAt = 0;
      void refreshUI().then(() => scrollAppToTop(viewContainer));
      return;
    }
    handleRootBack();
  };

  // Native Android Back is intercepted in MainActivity and forwarded here.
  window.addEventListener('speakcoach:back', handleSystemBack);

  // Browser preview uses one guard entry and the same Back handler as Android.
  if (!Capacitor.isNativePlatform()) {
    try {
      window.history.pushState({ speakCoachGuard: true }, '', window.location.href);
      window.addEventListener('popstate', () => {
        try { window.history.pushState({ speakCoachGuard: true }, '', window.location.href); } catch { /* Ignore preview history restrictions. */ }
        handleSystemBack();
      });
    } catch {
      // Browser history guard is optional in restricted embedded previews.
    }
  }

  await networkMonitor.init();
  networkMonitor.subscribe((online) => {
    clearDiagnosticsCache();
    // Publish connectivity without rebuilding the active view. Rebuilding it
    // can cancel an IELTS session and interrupt a Shadowing recording.
    document.documentElement.dataset.networkStatus = online ? 'online' : 'offline';
    window.dispatchEvent(new CustomEvent('speakcoach:network-status-change', {
      detail: { online }
    }));
  });

  const pauseForBackground = (): void => {
    // Android may briefly report the WebView as hidden while its native microphone permission dialog is open.
    if (audioRecorder.isRequestingMicPermission()) return;
    stopAllTts();
    if (lifecyclePauseInProgress) return;

    const status = ieltsSessionEngine.getSnapshot().status;
    const sessionBusy = [
      'examiner_speaking', 'cue_tone', 'prep_countdown', 'recording'
    ].includes(status);

    if (currentTab === 'ielts' && sessionBusy) {
      lifecyclePauseInProgress = true;
      void ieltsSessionEngine.pauseForBackground().finally(() => {
        lifecyclePauseInProgress = false;
      });
    } else if (currentTab === 'shadowing' || audioRecorder.isRecording()) {
      lifecyclePauseInProgress = true;
      const stopActiveCapture = currentTab === 'shadowing'
        ? pauseShadowingRecordingForBackground()
        : audioRecorder.stop().then(() => undefined);
      void stopActiveCapture.finally(() => {
        lifecyclePauseInProgress = false;
      });
    }
  };

  const handleAppVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      pauseForBackground();
      return;
    }
    // Re-render only after returning to the foreground. The session engine's
    // paused/error state and saved answers remain intact.
    if (currentTab === 'shadowing') void refreshUI();
  };

  document.addEventListener('visibilitychange', handleAppVisibilityChange);
  window.addEventListener('pagehide', pauseForBackground);

  await refreshUI();
}

if (typeof document !== 'undefined') {
  const rootEl = document.getElementById('app');
  if (rootEl) {
    void bootstrapApp(rootEl);
  }
}
