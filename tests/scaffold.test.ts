import { beforeEach, describe, expect, it } from 'vitest';
import { bootstrapApp, getAppVersion } from '../src/main';

describe('App Scaffold', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the current app version', () => {
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('renders the streamlined three-item navigation without the redundant top header', async () => {
    const root = document.createElement('div');
    await bootstrapApp(root);
    expect(root.querySelector('.top-bar')).toBeNull();
    expect(root.querySelector('.brand-title')).toBeNull();
    expect(root.querySelector('#global-tier-badge')).toBeNull();
    expect(root.querySelectorAll('.nav-btn')).toHaveLength(3);
    expect(root.querySelector('#nav-shadowing')).not.toBeNull();
    expect(root.querySelector('#nav-ielts')).not.toBeNull();
    expect(root.querySelector('#nav-settings')).not.toBeNull();
  });
});
