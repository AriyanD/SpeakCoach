import { SLOT_DEFINITIONS, SLOT_ORDER } from '../config/providers';
import { runFullDiagnostics, type DiagnosticsReport } from '../services/diagnostics';
import { getLastIeltsEvaluation, getIeltsSessionLogs } from '../services/ieltsTelemetry';

let cachedReport: DiagnosticsReport | null = null;

function badgeForBool(ok: boolean, passLabel = 'PASS', failLabel = 'FAIL'): string {
  return `<span class="tier-badge ${ok ? 'online' : 'offline'}"><span class="tier-dot"></span>${
    ok ? passLabel : failLabel
  }</span>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLastAttemptSection(report: DiagnosticsReport): string {
  const attempt = report.lastShadowingAttempt;
  if (!attempt) {
    return `
      <section class="card" id="diag-last-attempt-card">
        <div class="card-header">
          <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3m-4 0h8"/></svg> Last Shadowing Attempt</h2>
          <span class="tier-badge offline"><span class="tier-dot"></span>NONE YET</span>
        </div>
        <p class="card-subtitle" id="diag-last-attempt-empty">
          No shadowing attempt recorded in this session yet. Record an attempt in the Shadowing tab to inspect raw recognizer output and word alignment here.
        </p>
      </section>
    `;
  }

  const altsText =
    attempt.recognizerAlternatives.length > 0
      ? attempt.recognizerAlternatives
          .map((a) => `"${escapeHtml(a.transcript)}" (${Math.round(a.confidence * 100)}%)`)
          .join(' · ')
      : 'None';

  const alignmentSummary =
    attempt.words.length > 0
      ? attempt.words
          .map((w) => {
            const label = w.referenceWord ?? `+${w.spokenWord ?? ''}`;
            return `${escapeHtml(label)} [${w.status}:${w.accuracyScore}%]`;
          })
          .join(', ')
      : 'No words aligned (empty recognizer output — not scored)';

  const wordTimestampsSummary =
    attempt.sttWordTimestamps && attempt.sttWordTimestamps.length > 0
      ? attempt.sttWordTimestamps
          .map((w) => `${escapeHtml(w.word)} [${w.startMs}–${w.endMs} ms]`)
          .join(', ')
      : 'No word timestamps recorded';

  return `
    <section class="card" id="diag-last-attempt-card">
      <div class="card-header">
        <div>
          <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3m-4 0h8"/></svg> Last Shadowing Attempt</h2>
          <p class="card-subtitle">Recorded at ${attempt.timestamp.slice(11, 19)} UTC${
            attempt.sttActiveTierLabel ? ` · STT Tier: ${escapeHtml(attempt.sttActiveTierLabel)}` : ''
          }</p>
        </div>
        ${badgeForBool(!attempt.wasEmptyRecognition, `SCORE ${attempt.overallScore}`, 'EMPTY (0)')}
      </div>

      <div class="slot-summary-list">
        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Reference Sentence</div>
            <div class="card-subtitle" id="diag-last-ref">${escapeHtml(attempt.referenceText)}</div>
          </div>
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Raw Recognizer Text &amp; Confidence</div>
            <div class="card-subtitle" id="diag-last-raw">
              ${
                attempt.rawRecognizerText
                  ? `"${escapeHtml(attempt.rawRecognizerText)}" (${Math.round(
                      attempt.recognizerConfidence * 100
                    )}%)`
                  : '(EMPTY — Nothing recognized)'
              }
              ${attempt.recognizerError ? ` · Error: ${escapeHtml(attempt.recognizerError)}` : ''}
            </div>
          </div>
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Recognizer Alternatives</div>
            <div class="card-subtitle" id="diag-last-alts">${altsText}</div>
          </div>
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">STT Word List with Start/End Times</div>
            <div class="card-subtitle" id="diag-last-word-timestamps">${wordTimestampsSummary}</div>
          </div>
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Alignment Result Per Word</div>
            <div class="card-subtitle" id="diag-last-alignment">${alignmentSummary}</div>
          </div>
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Scores (Overall / Word Match / Fluency / Completeness)</div>
            <div class="card-subtitle" id="diag-last-scores">
              Overall: ${attempt.overallScore} · Word match estimate: ${attempt.pronunciationScore} · Fluency: ${attempt.fluencyScore} · Completeness: ${attempt.completenessScore}%
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

async function renderLastIeltsSection(): Promise<string> {
  const lastIelts = await getLastIeltsEvaluation();
  if (!lastIelts) {
    return `
      <section class="card" id="diag-last-ielts-card">
        <div class="card-header">
          <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11v5c3 2.2 7 2.2 10 0v-5M21 9v6"/></svg> Last IELTS Evaluation</h2>
          <span class="tier-badge offline"><span class="tier-dot"></span>NONE YET</span>
        </div>
        <p class="card-subtitle">
          No mock test completed in this session yet. Take an IELTS mock test to view band telemetry and detailed criteria breakdown here.
        </p>
      </section>
    `;
  }

  const evalRes = lastIelts.evaluation;
  const legacyUnverifiedBand = Boolean(typeof lastIelts.overallBand === 'number' && (!evalRes?.activeTier || evalRes.activeTier.tier >= 3));
  if (!evalRes || lastIelts.overallBand === null || legacyUnverifiedBand) {
    return `
      <section class="card" id="diag-last-ielts-card">
        <div class="card-header">
          <div>
            <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11v5c3 2.2 7 2.2 10 0v-5M21 9v6"/></svg> Last IELTS Evaluation (${lastIelts.mode.toUpperCase()})</h2>
            <p class="card-subtitle">Band: None (Evaluation failed) · ${escapeHtml(lastIelts.evaluationError || 'Service unavailable')}</p>
          </div>
          <span class="tier-badge offline">
            <span class="tier-dot"></span>FAILED
          </span>
        </div>
        <div class="slot-summary-list">
          <div class="slot-summary-row">
            <div>
              <div class="slot-summary-title">Failure Reason</div>
              <div class="card-subtitle diag-error-mono">
                ${escapeHtml(lastIelts.evaluationError || 'No evaluation completed')}
              </div>
            </div>
          </div>
          <div class="slot-summary-row">
            <div>
              <div class="slot-summary-title">Answers Preserved</div>
              <div class="card-subtitle">${lastIelts.answers.length} question(s) saved in history</div>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  const isAiAssisted = evalRes.activeTier.tier < 3;
  return `
    <section class="card" id="diag-last-ielts-card">
      <div class="card-header">
        <div>
          <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11v5c3 2.2 7 2.2 10 0v-5M21 9v6"/></svg> Last IELTS Evaluation (${lastIelts.mode.toUpperCase()})</h2>
          <p class="card-subtitle">Band: ${lastIelts.overallBand.toFixed(1)} · ${isAiAssisted ? 'AI-assisted practice estimate' : 'Offline analysis'}</p>
        </div>
        <span class="tier-badge ${isAiAssisted ? 'online' : 'offline'}">
          <span class="tier-dot"></span>ESTIMATE ${lastIelts.overallBand.toFixed(1)}
        </span>
      </div>
      <div class="slot-summary-list">
        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Assessed criteria (FC / LR / GRA; Pronunciation not assessed)</div>
            <div class="card-subtitle">
              FC: ${evalRes.fluencyCoherenceBand != null ? evalRes.fluencyCoherenceBand.toFixed(1) : '—'} ·
              LR: ${evalRes.lexicalResourceBand != null ? evalRes.lexicalResourceBand.toFixed(1) : '—'} ·
              GRA: ${evalRes.grammaticalRangeBand != null ? evalRes.grammaticalRangeBand.toFixed(1) : '—'} ·
              PR: Not assessed
            </div>
          </div>
        </div>
        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Answers Evaluated</div>
            <div class="card-subtitle">${lastIelts.answers.length} question(s) transcribed</div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderIeltsSessionLogsSection(): string {
  const logs = getIeltsSessionLogs();
  if (logs.length === 0) {
    return `
      <section class="card" id="diag-ielts-logs-card">
        <div class="card-header">
          <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8M9 3h6v3H9zM6 5H4v16h16V5h-2"/><path d="M8 11h8M8 15h8"/></svg> Last IELTS Session Log</h2>
          <span class="tier-badge offline"><span class="tier-dot"></span>EMPTY</span>
        </div>
        <p class="card-subtitle">
          No IELTS session events logged yet. Start a test to record transition timestamps and error diagnostics here.
        </p>
      </section>
    `;
  }

  const hasError = logs.some((l) => Boolean(l.error));
  const logRows = logs
    .slice(-15)
    .map((l) => {
      const timeStr = l.timestamp.slice(11, 19);
      const isErr = Boolean(l.error);
      return `
        <div class="slot-summary-row diag-log-row">
          <div>
            <div class="diag-log-title ${isErr ? 'has-error' : ''}">
              [${timeStr}] ${escapeHtml(l.event)} (${escapeHtml(l.status)})
            </div>
            ${l.details ? `<div class="diag-log-detail">${escapeHtml(l.details)}</div>` : ''}
            ${l.error ? `<div class="diag-log-error">Error: ${escapeHtml(l.error)}</div>` : ''}
          </div>
          <span class="tier-badge diag-log-badge ${isErr ? 'offline' : 'online'}">
            ${isErr ? 'ERROR' : 'OK'}
          </span>
        </div>
      `;
    })
    .join('');

  return `
    <section class="card" id="diag-ielts-logs-card">
      <div class="card-header">
        <div>
          <h2 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8M9 3h6v3H9zM6 5H4v16h16V5h-2"/><path d="M8 11h8M8 15h8"/></svg> Last IELTS Session Log</h2>
          <p class="card-subtitle">${logs.length} event(s) recorded in session history</p>
        </div>
        <span class="tier-badge ${hasError ? 'offline' : 'online'}">
          <span class="tier-dot"></span>${hasError ? 'ERRORS LOGGED' : 'HEALTHY'}
        </span>
      </div>
      <div class="slot-summary-list diag-log-list">
        ${logRows}
      </div>
    </section>
  `;
}

export async function renderDiagnosticsView(
  container: HTMLElement,
  appVersion: string,
  onRefreshShell: () => Promise<void>
): Promise<void> {
  if (!cachedReport) {
    cachedReport = await runFullDiagnostics({ appVersion });
  }
  const report = cachedReport;

  const micOk = report.micPermissionStatus === 'granted';
  const micLabel = report.micPermissionStatus.toUpperCase();

  const slotRowsHtml = SLOT_ORDER.map((slotId) => {
    const def = SLOT_DEFINITIONS[slotId];
    const resolved = report.tierSummary.slots[slotId];
    const conn = report.slotConnections[slotId];
    const isOnlineTier = resolved.label === 'Online AI';

    return `
      <div class="slot-summary-row" data-diag-slot="${escapeHtml(slotId)}">
        <div>
          <div class="slot-summary-title">${escapeHtml(def.title)}</div>
          <div class="card-subtitle">Active: <strong>${escapeHtml(resolved.detailLabel)}</strong></div>
          <div class="card-subtitle">${escapeHtml(conn.message)}</div>
        </div>
        <span class="tier-badge ${isOnlineTier ? 'online' : 'offline'}">
          <span class="tier-dot"></span>
          ${resolved.label}
        </span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <section class="card" id="diagnostics-panel">
      <div class="card-header">
        <div>
          <h1 class="card-title"><svg class="diag-heading-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg> System Diagnostics</h1>
          <p class="card-subtitle">Screenshot-ready status of permissions, storage, TTS &amp; 5 slots</p>
        </div>
        <span class="tier-badge ${report.tierSummary.label === 'Online AI' ? 'online' : 'offline'}">
          <span class="tier-dot"></span>
          ${report.tierSummary.label}
        </span>
      </div>

      <div class="slot-summary-list">
        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">App / Build Version &amp; Platform</div>
            <div class="card-subtitle" id="diag-version-text">
              v${escapeHtml(report.appVersion)} · Platform: ${escapeHtml(report.platform)} · Checked: ${escapeHtml(report.timestamp.slice(11, 19))} UTC
            </div>
          </div>
          ${badgeForBool(report.networkOnline, 'ONLINE', 'OFFLINE')}
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Microphone Permission</div>
            <div class="card-subtitle" id="diag-mic-detail">${escapeHtml(report.micPermissionDetail)}</div>
          </div>
          ${badgeForBool(micOk, micLabel, micLabel)}
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Native TTS Availability</div>
            <div class="card-subtitle" id="diag-tts-detail">${escapeHtml(report.nativeTtsDetail)}</div>
          </div>
          ${badgeForBool(report.nativeTtsAvailable, 'READY', 'UNAVAILABLE')}
        </div>

        <div class="slot-summary-row">
          <div>
            <div class="slot-summary-title">Secure Key Storage R/W Self-Test</div>
            <div class="card-subtitle" id="diag-keystore-detail">${escapeHtml(report.secureKeyStoreDetail)}</div>
          </div>
          ${badgeForBool(report.secureKeyStoreOk, 'PASS', 'FAIL')}
        </div>
      </div>

      <div class="btn-row">
        <button type="button" class="btn btn-secondary" id="diag-request-mic-btn">
          <svg class="diag-action-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3m-4 0h8"/></svg> Request Mic Permission
        </button>
        <button type="button" class="btn btn-primary" id="diag-run-all-btn">
          <svg class="diag-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/></svg> Run Live Check (All 5 Slots)
        </button>
      </div>
    </section>

    ${renderLastAttemptSection(report)}
    ${await renderLastIeltsSection()}
    ${renderIeltsSessionLogsSection()}

    <section class="card">
      <div class="card-header">
        <h2 class="card-title">Per-Slot Active Tier &amp; Connection Status</h2>
      </div>
      <div class="slot-summary-list">
        ${slotRowsHtml}
      </div>
    </section>
  `;

  const reqMicBtn = container.querySelector<HTMLButtonElement>('#diag-request-mic-btn');
  const runAllBtn = container.querySelector<HTMLButtonElement>('#diag-run-all-btn');

  reqMicBtn?.addEventListener('click', async () => {
    reqMicBtn.disabled = true;
    reqMicBtn.textContent = 'Requesting Mic...';
    cachedReport = await runFullDiagnostics({ appVersion, requestMic: true });
    await onRefreshShell();
  });

  runAllBtn?.addEventListener('click', async () => {
    runAllBtn.disabled = true;
    runAllBtn.textContent = 'Probing 5 Slots...';
    cachedReport = await runFullDiagnostics({
      appVersion,
      probeNetworkSlots: true
    });
    await onRefreshShell();
  });
}

export function clearDiagnosticsCache(): void {
  cachedReport = null;
}
