import { describe, expect, it, vi } from 'vitest';
import { SLOT_ORDER } from '../src/config/providers';
import { bindSecondaryApiTestActions } from '../src/ui/secondaryApiTestBinding';

describe('secondary API test click binding', () => {
  it('dispatches visible API 2 button clicks through the settings root', () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    const slotId = SLOT_ORDER[0];
    button.dataset.testSecondarySlot = slotId;
    container.append(button);
    const onTest = vi.fn();

    bindSecondaryApiTestActions(container, onTest);
    button.click();

    expect(onTest).toHaveBeenCalledOnce();
    expect(onTest).toHaveBeenCalledWith(slotId, button);
  });

  it('ignores unknown, disabled and hidden API 2 buttons', () => {
    const container = document.createElement('div');
    const onTest = vi.fn();
    bindSecondaryApiTestActions(container, onTest);

    const unknown = document.createElement('button');
    unknown.dataset.testSecondarySlot = 'unknown-slot';
    const disabled = document.createElement('button');
    disabled.dataset.testSecondarySlot = SLOT_ORDER[0];
    disabled.disabled = true;
    const hiddenWrapper = document.createElement('div');
    hiddenWrapper.hidden = true;
    const hidden = document.createElement('button');
    hidden.dataset.testSecondarySlot = SLOT_ORDER[1];
    hiddenWrapper.append(hidden);
    container.append(unknown, disabled, hiddenWrapper);

    unknown.click();
    disabled.click();
    hidden.click();

    expect(onTest).not.toHaveBeenCalled();
  });

  it('replaces an existing binding when the same settings container is rendered again', () => {
    const container = document.createElement('div');
    const button = document.createElement('button');
    button.dataset.testSecondarySlot = SLOT_ORDER[0];
    container.append(button);
    const oldHandler = vi.fn();
    const newHandler = vi.fn();

    bindSecondaryApiTestActions(container, oldHandler);
    bindSecondaryApiTestActions(container, newHandler);
    button.click();

    expect(oldHandler).not.toHaveBeenCalled();
    expect(newHandler).toHaveBeenCalledOnce();
  });
});
