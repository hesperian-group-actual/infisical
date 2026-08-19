import RE2 from "re2";

import { applyJitter } from "@app/lib/dates";
import { delay as delayMs } from "@app/lib/delay";
import { ExecutionResult } from "@app/lib/red-lock";

import { TKeyStoreFactory } from "./keystore";

const toFullKey = (key: string, prefix?: string) => (prefix ? `${prefix}:${key}` : key);

const parseExpirySeconds = (expiryInSeconds: number | string) => {
  const seconds = typeof expiryInSeconds === "number" ? expiryInSeconds : Number(expiryInSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

export const inMemoryKeyStore = (): TKeyStoreFactory => {
  const store: Record<string, string | number | Buffer> = {};
  const listStore: Record<string, string[]> = {};
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const getRegex = (pattern: string) =>
    new RE2(`^${pattern.replace(/[-[\]/{}()+?.\\^$|]/g, "\\$&").replace(/\*/g, ".*")}$`);

  const clearExpiry = (key: string) => {
    const timer = expiryTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      expiryTimers.delete(key);
    }
  };

  const scheduleExpiry = (key: string, expiryInSeconds: number | string) => {
    clearExpiry(key);
    const seconds = parseExpirySeconds(expiryInSeconds);
    if (!seconds) return;
    expiryTimers.set(
      key,
      setTimeout(() => {
        delete store[key];
        delete listStore[key];
        expiryTimers.delete(key);
      }, seconds * 1000)
    );
  };

  const setItem: TKeyStoreFactory["setItem"] = async (key, value, prefix) => {
    const fullKey = toFullKey(key, prefix);
    store[fullKey] = value;
    return "OK";
  };

  const getItem: TKeyStoreFactory["getItem"] = async (key, prefix) => {
    const value = store[toFullKey(key, prefix)];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (Buffer.isBuffer(value)) return value.toString();
    return null;
  };

  const getItems: TKeyStoreFactory["getItems"] = async (keys, prefix) =>
    Promise.all(keys.map((key) => getItem(key, prefix)));

  const setExpiry: TKeyStoreFactory["setExpiry"] = async (key, expiryInSeconds) => {
    if (!(key in store) && !(key in listStore)) return 0;
    scheduleExpiry(key, expiryInSeconds);
    return 1;
  };

  const setItemWithExpiry: TKeyStoreFactory["setItemWithExpiry"] = async (key, expiryInSeconds, value, prefix) => {
    const fullKey = toFullKey(key, prefix);
    store[fullKey] = value;
    scheduleExpiry(fullKey, expiryInSeconds);
    return "OK";
  };

  const deleteItem: TKeyStoreFactory["deleteItem"] = async (key) => {
    const existed = key in store || key in listStore;
    clearExpiry(key);
    delete store[key];
    delete listStore[key];
    return existed ? 1 : 0;
  };

  const deleteItemsByKeyIn: TKeyStoreFactory["deleteItemsByKeyIn"] = async (keys) => {
    let deleted = 0;
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      deleted += await deleteItem(key);
    }
    return deleted;
  };

  const deleteItems: TKeyStoreFactory["deleteItems"] = async ({
    pattern,
    batchSize = 500,
    delay = 1500,
    jitter = 200
  }) => {
    const regex = getRegex(pattern);
    let totalDeleted = 0;
    const keys = [...new Set([...Object.keys(store), ...Object.keys(listStore)])];

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      for (const key of batch) {
        if (regex.test(key)) {
          // eslint-disable-next-line no-await-in-loop
          await deleteItem(key);
          totalDeleted += 1;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await delayMs(Math.max(0, applyJitter(delay, jitter)));
    }

    return totalDeleted;
  };

  const incrementBy: TKeyStoreFactory["incrementBy"] = async (key, value) => {
    const current = Number(store[key] ?? 0);
    const next = (Number.isFinite(current) ? current : 0) + value;
    store[key] = next;
    return next;
  };

  const getKeysByPattern: TKeyStoreFactory["getKeysByPattern"] = async (pattern, limit) => {
    const regex = getRegex(pattern);
    const keys = [...new Set([...Object.keys(store), ...Object.keys(listStore)])].filter((key) => regex.test(key));
    return typeof limit === "number" ? keys.slice(0, limit) : keys;
  };

  const listPush: TKeyStoreFactory["listPush"] = async (key, value) => {
    if (!listStore[key]) listStore[key] = [];
    listStore[key].push(value);
    return listStore[key].length;
  };

  const listRange: TKeyStoreFactory["listRange"] = async (key, start, stop) => {
    if (!listStore[key]) return [];
    const list = listStore[key];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  };

  const listRemove: TKeyStoreFactory["listRemove"] = async (key, _count, value) => {
    if (!listStore[key]) return 0;
    const originalLength = listStore[key].length;
    listStore[key] = listStore[key].filter((item) => item !== value);
    return originalLength - listStore[key].length;
  };

  const listLength: TKeyStoreFactory["listLength"] = async (key) => listStore[key]?.length ?? 0;

  const waitTillReady: TKeyStoreFactory["waitTillReady"] = async ({
    key,
    waitingCb,
    keyCheckCb,
    waitIteration = 10,
    delay = 1000,
    jitter = 200
  }) => {
    let attempts = 0;
    let isReady = keyCheckCb(await getItem(key));
    while (!isReady) {
      if (attempts > waitIteration) return;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        waitingCb?.();
        setTimeout(resolve, Math.max(0, applyJitter(delay, jitter)));
      });
      attempts += 1;
      // eslint-disable-next-line no-await-in-loop
      isReady = keyCheckCb(await getItem(key));
    }
  };

  return {
    setItem,
    getItem,
    getItems,
    setExpiry,
    setItemWithExpiry,
    deleteItem,
    deleteItemsByKeyIn,
    deleteItems,
    incrementBy,
    getKeysByPattern,
    listPush,
    listRange,
    listRemove,
    listLength,
    streamAdd: async () => null,
    streamRange: async () => [],
    streamTrim: async () => 0,
    streamCollect: async () => ({ entries: [], lastId: null }),
    pgIncrementBy: async (key, { incr = 1 }) => incrementBy(key, incr),
    pgGetIntItem: async (key, prefix) => {
      const value = store[toFullKey(key, prefix)];
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    },
    acquireLock: async () => ({
      release: async (): Promise<ExecutionResult> => ({ attempts: [], start: Date.now() })
    }),
    waitTillReady
  };
};
