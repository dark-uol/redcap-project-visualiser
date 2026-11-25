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
