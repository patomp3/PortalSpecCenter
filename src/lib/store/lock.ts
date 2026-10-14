import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "@/lib/config";
import { LockTimeoutError } from "./errors";

const STALE_MS = 30_000;
const TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kept on globalThis so Next.js dev-mode module reloads share one queue.
const g = globalThis as unknown as { __portalLockChains?: Map<string, Promise<void>> };
const chains = (g.__portalLockChains ??= new Map());

/**
 * Run `fn` exclusively for `key`.
 * Layer 1: an in-process promise queue (cheap, ordered).
 * Layer 2: a lock file created with O_EXCL, guarding against other processes.
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  chains.set(key, tail);

  await prev;
  try {
    return await withFileLock(key, fn);
  } finally {
    release();
    if (chains.get(key) === tail) chains.delete(key);
  }
}

async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const dir = paths.locksDir();
  const file = path.join(dir, `${key.replace(/[^a-zA-Z0-9._-]/g, "_")}.lock`);
  await fs.mkdir(dir, { recursive: true });

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    try {
      const fh = await fs.open(file, "wx");
      await fh.writeFile(`${process.pid} ${new Date().toISOString()}`);
      await fh.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      await removeIfStale(file);
      if (Date.now() > deadline) throw new LockTimeoutError(key);
      await sleep(10 + Math.random() * 40);
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(file, { force: true });
  }
}

async function removeIfStale(file: string) {
  try {
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs > STALE_MS) await fs.rm(file, { force: true });
  } catch {
    // Already released by its owner.
  }
}
