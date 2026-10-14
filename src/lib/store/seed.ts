import fs from "node:fs/promises";
import path from "node:path";
import { dataDir, paths, seedDir } from "@/lib/config";
import { readText, writeFileAtomic } from "./fs-atomic";
import { withLock } from "./lock";

export const DEFAULT_USERS_TXT = `# API Portal admin accounts — one per line, format: email:password
# Lines starting with # are ignored. CHANGE THIS DEFAULT PASSWORD before deploying.
admin@example.com:admin123
`;

const g = globalThis as unknown as { __portalBootstrap?: Map<string, Promise<void>> };
const done = (g.__portalBootstrap ??= new Map());

/**
 * Make sure DATA_DIR has the files the app needs. Runs once per DATA_DIR per process:
 * creates a default users.txt and copies the seed specs when versions.json is missing.
 */
export function ensureBootstrap(): Promise<void> {
  const key = dataDir();
  let p = done.get(key);
  if (!p) {
    p = bootstrap().catch((err) => {
      done.delete(key);
      throw err;
    });
    done.set(key, p);
  }
  return p;
}

async function bootstrap() {
  await withLock("bootstrap", async () => {
    await fs.mkdir(paths.specsDir(), { recursive: true });

    if ((await readText(paths.users())) === null) {
      await writeFileAtomic(paths.users(), DEFAULT_USERS_TXT);
      console.warn(
        `[portal] Created ${paths.users()} with default admin "admin@example.com". Change its password!`,
      );
    }

    if ((await readText(paths.versions())) === null) {
      const src = seedDir();
      const specFiles = await fs.readdir(path.join(src, "specs")).catch(() => [] as string[]);
      for (const name of specFiles.filter((f) => f.endsWith(".json"))) {
        const content = await fs.readFile(path.join(src, "specs", name), "utf8");
        await writeFileAtomic(path.join(paths.specsDir(), name), content);
      }
      const versions = (await readText(path.join(src, "versions.json"))) ?? '{ "versions": [] }\n';
      // versions.json last: its presence marks the bootstrap as complete.
      await writeFileAtomic(paths.versions(), versions);
      console.info(`[portal] Seeded ${dataDir()} from ${src}`);
    }
  });
}
