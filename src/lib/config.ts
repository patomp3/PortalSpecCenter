import path from "node:path";

/** Resolved on every call so tests (and scripts) can point DATA_DIR elsewhere. */
export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "./data");
}

export function seedDir(): string {
  return path.resolve(process.env.SEED_DIR || "./seed");
}

export const paths = {
  users: () => path.join(dataDir(), "users.txt"),
  sessions: () => path.join(dataDir(), "sessions.json"),
  versions: () => path.join(dataDir(), "versions.json"),
  specsDir: () => path.join(dataDir(), "specs"),
  spec: (version: string) => path.join(dataDir(), "specs", `${version}.json`),
  audit: () => path.join(dataDir(), "audit.log"),
  locksDir: () => path.join(dataDir(), ".locks"),
};
