// jsdom does not implement real media playback. Simulate a short, successful
// playback so production code waiting for the media "ended" event can settle.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: vi.fn(function (this: HTMLMediaElement) {
    queueMicrotask(() => {
      this.dispatchEvent(new Event('ended'));
    });
    return Promise.resolve();
  })
});

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  value: vi.fn()
});

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn()
});
