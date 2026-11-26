import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachScrollRail } from '../src/ui/scrollRail';

function makeField(): { field: HTMLElement; body: HTMLElement; rail: HTMLElement; track: HTMLElement; up: HTMLButtonElement; down: HTMLButtonElement } {
  const field = document.createElement('div');
  field.className = 'sh-scroll-field';
  field.innerHTML = `
    <div class="sh-scroll-body"></div>
    <div class="sh-scroll-rail">
      <button class="sh-scroll-arrow is-up"></button>
      <div class="sh-scroll-track" role="scrollbar" tabindex="0"><div class="sh-scroll-thumb"></div></div>
      <button class="sh-scroll-arrow is-down"></button>
    </div>`;
  document.body.appendChild(field);
  const body = field.querySelector<HTMLElement>('.sh-scroll-body')!;
  const rail = field.querySelector<HTMLElement>('.sh-scroll-rail')!;
  const track = field.querySelector<HTMLElement>('.sh-scroll-track')!;
  const up = field.querySelector<HTMLButtonElement>('.sh-scroll-arrow.is-up')!;
  const down = field.querySelector<HTMLButtonElement>('.sh-scroll-arrow.is-down')!;
  Object.defineProperties(body, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 300 }
  });
  Object.defineProperty(track, 'clientHeight', { configurable: true, value: 120 });
  track.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 14, bottom: 120, width: 14, height: 120, toJSON: () => ({}) });
  Object.defineProperty(body, 'scrollBy', { configurable: true, value: vi.fn((options: ScrollToOptions = {}) => {
    body.scrollTop = Math.max(0, Math.min(200, body.scrollTop + (options.top ?? 0)));
    body.dispatchEvent(new Event('scroll'));
  }) });
  Object.defineProperty(body, 'scrollTo', { configurable: true, value: vi.fn((options: ScrollToOptions = {}) => {
    body.scrollTop = Math.max(0, Math.min(200, options.top ?? 0));
    body.dispatchEvent(new Event('scroll'));
  }) });
  return { field, body, rail, track, up, down };
}
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
describe('attachScrollRail', () => {
  it('sizes and positions the thumb, updates aria state, and pages with the arrows', () => {
    const { field, body, track, up, down } = makeField();
    const controller = attachScrollRail(field);
    expect(controller).not.toBeNull();
    expect(track.getAttribute('aria-valuenow')).toBe('0');
    expect(field.querySelector<HTMLElement>('.sh-scroll-thumb')?.style.height).toBe('40px');
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(false);
    body.scrollTop = 100;
    body.dispatchEvent(new Event('scroll'));
    expect(track.getAttribute('aria-valuenow')).toBe('50');
    expect(field.querySelector<HTMLElement>('.sh-scroll-thumb')?.style.transform).toContain('translateY');
    down.click();
    expect(body.scrollBy).toHaveBeenCalledWith({ top: 75, behavior: 'smooth' });
    body.scrollTop = 200;
    body.dispatchEvent(new Event('scroll'));
    up.click();
    expect(body.scrollBy).toHaveBeenLastCalledWith({ top: -75, behavior: 'smooth' });
    controller?.destroy();
  });
  it('keeps the rail visible but idle when content fits', () => {
    const { field, body, rail, up, down } = makeField();
    const controller = attachScrollRail(field);
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 100 });
    controller?.sync();
    expect(rail.classList.contains('is-idle')).toBe(true);
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
    expect(field.querySelector<HTMLElement>('.sh-scroll-thumb')?.style.height).toBe('120px');
    controller?.destroy();
  });
  it('disconnects resize and mutation observers on cleanup', () => {
    class MockResizeObserver {
      static instances: MockResizeObserver[] = [];
      disconnect = vi.fn();
      observe = vi.fn();
      unobserve = vi.fn();
      constructor(_callback: ResizeObserverCallback) { MockResizeObserver.instances.push(this); }
    }
    class MockMutationObserver {
      static instances: MockMutationObserver[] = [];
      disconnect = vi.fn();
      observe = vi.fn();
      takeRecords = vi.fn(() => []);
      constructor(_callback: MutationCallback) { MockMutationObserver.instances.push(this); }
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('MutationObserver', MockMutationObserver);
    const { field } = makeField();
    const controller = attachScrollRail(field, { root: document.body, observeMutations: true });
    expect(MockResizeObserver.instances).toHaveLength(1);
    expect(MockMutationObserver.instances).toHaveLength(1);
    controller?.destroy();
    expect(MockResizeObserver.instances[0].disconnect).toHaveBeenCalledOnce();
    expect(MockMutationObserver.instances[0].disconnect).toHaveBeenCalledOnce();
  });
});
