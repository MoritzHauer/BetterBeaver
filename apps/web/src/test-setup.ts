// jsdom doesn't implement matchMedia; theme.ts reads it at import time.
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;

// jsdom doesn't implement `<dialog>`'s modal API either (checked against the
// jsdom this repo resolves: `showModal` is undefined), and `Sheet` calls it on
// mount — without this, rendering any dialog in a test throws. Enough of the
// contract for a render test: `open` reflects, and `close()` fires the event
// React exposes as `onClose`. The real focus trap, top layer and `::backdrop`
// are browser behaviours no shim can stand in for, which is why the sheets are
// browser-verified separately rather than asserted here.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (
  this: HTMLDialogElement,
  returnValue?: string,
) {
  this.open = false;
  if (returnValue !== undefined) {
    this.returnValue = returnValue;
  }
  this.dispatchEvent(new Event("close"));
};
