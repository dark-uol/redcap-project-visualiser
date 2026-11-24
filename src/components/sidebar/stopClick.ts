/** Wraps a click handler so the click does not toggle the surrounding <summary>. */
export function stopClick(action: () => void) {
  return function onStoppedClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    action();
  };
}
