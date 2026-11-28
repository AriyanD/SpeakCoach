import { SLOT_ORDER } from '../config/providers';
import type { SlotId } from '../config/types';

const bindings = new WeakMap<HTMLElement, (event: Event) => void>();

function isSlotId(value: string): value is SlotId {
  return (SLOT_ORDER as readonly string[]).includes(value);
}

/** Bind API 2 clicks at the settings root so per-card setup cannot leave a visible button inert. */
export function bindSecondaryApiTestActions(
  container: HTMLElement,
  onTest: (slotId: SlotId, button: HTMLButtonElement) => void
): void {
  const previous = bindings.get(container);
  if (previous) container.removeEventListener('click', previous);

  const handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>('[data-test-secondary-slot]');
    if (!button || !container.contains(button) || button.disabled) return;
    if (button.closest('[hidden]') || button.hidden) return;
    const slotId = button.dataset.testSecondarySlot ?? '';
    if (!isSlotId(slotId)) return;
    onTest(slotId, button);
  };

  container.addEventListener('click', handleClick);
  bindings.set(container, handleClick);
}
