// Shared helper so every service resolves like a real HTTP call would.
export const latency = <T,>(value: T, ms = 200): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));
