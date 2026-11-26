export interface ScrollRailOptions {
  root?: HTMLElement;
  observeMutations?: boolean;
  onScroll?: (scrollTop: number) => void;
}
export interface ScrollRailController {
  sync(): void;
  destroy(): void;
}
export function attachScrollRail(field: HTMLElement, options: ScrollRailOptions = {}): ScrollRailController | null {
  const body = field.querySelector<HTMLElement>('.sh-scroll-body');
  const rail = field.querySelector<HTMLElement>('.sh-scroll-rail');
  const track = field.querySelector<HTMLElement>('.sh-scroll-track');
  const thumb = field.querySelector<HTMLElement>('.sh-scroll-thumb');
  const up = field.querySelector<HTMLButtonElement>('.sh-scroll-arrow.is-up');
  const down = field.querySelector<HTMLButtonElement>('.sh-scroll-arrow.is-down');
  if (!body || !rail || !track || !thumb || !up || !down) return null;
  const removers: Array<() => void> = [];
  let destroyed = false;
  let activePointer: number | null = null;
  let dragOffset = 0;
  const listen = (target: EventTarget, type: string, listener: EventListener, listenerOptions?: AddEventListenerOptions | boolean): void => {
    target.addEventListener(type, listener, listenerOptions);
    removers.push(() => target.removeEventListener(type, listener, listenerOptions));
  };
  const sync = (): void => {
    if (destroyed) return;
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    const trackHeight = track.clientHeight || track.getBoundingClientRect().height;
    const idle = maxScroll <= 1;
    const thumbHeight = idle ? trackHeight : Math.min(trackHeight, Math.max(32, trackHeight * body.clientHeight / Math.max(1, body.scrollHeight)));
    const travel = Math.max(0, trackHeight - thumbHeight);
    const progress = idle ? 0 : Math.max(0, Math.min(1, body.scrollTop / maxScroll));
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${travel * progress}px)`;
    track.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    rail.classList.toggle('is-idle', idle);
    up.disabled = idle || body.scrollTop <= 0;
    down.disabled = idle || body.scrollTop >= maxScroll - 1;
  };
  const scrollByPage = (direction: -1 | 1): void => {
    body.scrollBy({ top: Math.max(100, body.clientHeight * 0.75) * direction, behavior: 'smooth' });
  };
  const pageFromPointer = (clientY: number): void => {
    const maxScroll = Math.max(0, body.scrollHeight - body.clientHeight);
    const rect = track.getBoundingClientRect();
    const trackHeight = track.clientHeight || rect.height;
    const thumbHeight = thumb.offsetHeight || Number.parseFloat(thumb.style.height) || 0;
    const travel = Math.max(0, trackHeight - thumbHeight);
    if (maxScroll <= 0 || travel <= 0) return;
    body.scrollTop = Math.max(0, Math.min(travel, clientY - rect.top - dragOffset)) / travel * maxScroll;
    options.onScroll?.(body.scrollTop);
    sync();
  };
  listen(body, 'scroll', () => { options.onScroll?.(body.scrollTop); sync(); }, { passive: true });
  listen(up, 'click', () => scrollByPage(-1));
  listen(down, 'click', () => scrollByPage(1));
  listen(track, 'pointerdown', event => {
    const pointer = event as PointerEvent;
    if (pointer.pointerType === 'mouse' && pointer.button !== 0) return;
    const thumbRect = thumb.getBoundingClientRect();
    const onThumb = pointer.target === thumb || (pointer.target instanceof Node && thumb.contains(pointer.target));
    dragOffset = onThumb ? pointer.clientY - thumbRect.top : (thumb.offsetHeight || Number.parseFloat(thumb.style.height) || 0) / 2;
    activePointer = pointer.pointerId;
    try { track.setPointerCapture(pointer.pointerId); } catch { /* Optional in embedded Android WebViews. */ }
    if (!onThumb) pageFromPointer(pointer.clientY);
    pointer.preventDefault();
  });
  listen(track, 'pointermove', event => {
    const pointer = event as PointerEvent;
    if (activePointer === pointer.pointerId) pageFromPointer(pointer.clientY);
  });
  const stopDragging: EventListener = event => {
    const pointer = event as PointerEvent;
    if (activePointer !== pointer.pointerId) return;
    activePointer = null;
    try { if (track.hasPointerCapture(pointer.pointerId)) track.releasePointerCapture(pointer.pointerId); } catch { /* Pointer may already be released. */ }
  };
  listen(track, 'pointerup', stopDragging);
  listen(track, 'pointercancel', stopDragging);
  listen(track, 'lostpointercapture', () => { activePointer = null; });
  listen(track, 'keydown', event => {
    const key = event as KeyboardEvent;
    const pageStep = Math.max(100, body.clientHeight * 0.75);
    if (key.key === 'ArrowUp') body.scrollBy({ top: -40, behavior: 'smooth' });
    else if (key.key === 'ArrowDown') body.scrollBy({ top: 40, behavior: 'smooth' });
    else if (key.key === 'PageUp') body.scrollBy({ top: -pageStep, behavior: 'smooth' });
    else if (key.key === 'PageDown') body.scrollBy({ top: pageStep, behavior: 'smooth' });
    else if (key.key === 'Home') body.scrollTo({ top: 0, behavior: 'smooth' });
    else if (key.key === 'End') body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
    else return;
    key.preventDefault();
  });
  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(body);
    resizeObserver.observe(track);
  }
  let mutationObserver: MutationObserver | null = null;
  if (options.observeMutations && typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(() => {
      if (!field.isConnected) destroy();
      else sync();
    });
    mutationObserver.observe(body, { childList: true, subtree: true });
    const root = options.root ?? field.parentElement;
    if (root && root !== body) mutationObserver.observe(root, { childList: true, subtree: true });
  }
  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    activePointer = null;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    removers.forEach(remove => remove());
    removers.length = 0;
  }
  sync();
  return { sync, destroy };
}
