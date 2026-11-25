import { render } from '@solidjs/web';
import type { JSX } from '@solidjs/web';
import { afterEach } from 'vitest';

const mounted: { container: HTMLElement; dispose: () => void }[] = [];

/** Renders a component into a detached-then-attached jsdom element and returns it. Disposed after each test. */
export function renderComponent(component: () => JSX.Element): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(component, container);
  mounted.push({ container, dispose });
  return container;
}

afterEach(function disposeMounted() {
  for (const { container, dispose } of mounted.splice(0)) {
    dispose();
    container.remove();
  }
});

/** Solid 2 applies a signal write at the next microtask: await this after an interaction before asserting. */
export const tick = (): Promise<void> => Promise.resolve();

/** Dispatches a bubbling `change` event, as a user finishing an edit of an input or select would. */
export function fireChange(element: Element): void {
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/** The button inside `container` whose text is exactly `label`. */
export function buttonLabelled(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error('No button labelled ' + JSON.stringify(label));
  return button;
}
