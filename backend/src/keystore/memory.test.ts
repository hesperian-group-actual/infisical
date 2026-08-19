import { afterEach, describe, expect, test, vi } from "vitest";

import { inMemoryKeyStore } from "./memory";

describe("inMemoryKeyStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("stores and returns string values", async () => {
    const store = inMemoryKeyStore();
    await store.setItem("alpha", "one");
    await expect(store.getItem("alpha")).resolves.toBe("one");
  });

  test("setItemWithExpiry uses (key, ttl, value) and expires the key", async () => {
    vi.useFakeTimers();
    const store = inMemoryKeyStore();

    await store.setItemWithExpiry("session", 2, "alive");
    await expect(store.getItem("session")).resolves.toBe("alive");

    await vi.advanceTimersByTimeAsync(2100);
    await expect(store.getItem("session")).resolves.toBeNull();
  });

  test("honors prefix on set/get", async () => {
    const store = inMemoryKeyStore();
    await store.setItem("id", "v", "oauth");
    await expect(store.getItem("id", "oauth")).resolves.toBe("v");
    await expect(store.getItem("id")).resolves.toBeNull();
  });
});
