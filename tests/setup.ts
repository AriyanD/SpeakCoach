// Keep jsdom's unimplemented browser APIs quiet in tests that do not
// exercise actual media playback or browser scrolling.
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined)
});

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  value: vi.fn()
});
