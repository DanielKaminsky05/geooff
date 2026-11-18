import "@testing-library/jest-dom";

// jsdom lacks ResizeObserver, which react-zoom-pan-pinch (WorldMap) relies on.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom in this environment doesn't ship a working localStorage; provide a
// minimal in-memory implementation so components that read/write it (session)
// work under test.
if (typeof globalThis.localStorage === "undefined" ||
    typeof globalThis.localStorage.getItem !== "function") {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    configurable: true,
  });
}
