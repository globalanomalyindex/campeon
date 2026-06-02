/**
 * Vitest setup file for jsdom environments.
 * Node 26 defines localStorage on globalThis as an experimental getter that
 * returns undefined (without --localstorage-file). This shadows the jsdom
 * localStorage that jsdom places on the window object.
 *
 * This setup restores window.localStorage from jsdom's own window when the
 * built-in getter returns undefined — so tests that exercise the default
 * window.localStorage backend work correctly.
 */
if (typeof window !== 'undefined') {
  const jsdomInternalWindow = (window as unknown as { jsdom?: { window?: Window } }).jsdom?.window;
  if (jsdomInternalWindow?.localStorage != null && window.localStorage == null) {
    Object.defineProperty(window, 'localStorage', {
      get: () => jsdomInternalWindow.localStorage,
      configurable: true,
    });
  }
}
