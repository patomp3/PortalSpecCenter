import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns null when the file does not exist. */
export async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readJson<T = unknown>(file: string): Promise<T | null> {
  const text = await readText(file);
  return text === null ? null : (JSON.parse(text) as T);
}

/**
 * Write to a temp file in the same directory, fsync, then rename over the target,
 * so readers only ever see the old or the new content — never a partial file.
 * On Windows rename can fail transiently while another handle has the file open.
 */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(content, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }

  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (RETRYABLE.has(code) && attempt < 6) {
        await sleep(20 * (attempt + 1));
        continue;
      }
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(data, null, 2) + "\n");
}
