import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { appendAudit } from "@/lib/audit/log";
import { paths } from "@/lib/config";
import {
  VersionNameSchema,
  VersionsFileSchema,
  type Spec,
  type Version,
  type VersionStatus,
} from "@/lib/schema";
import { NotFoundError, ValidationError } from "./errors";
import { readJson, writeJsonAtomic } from "./fs-atomic";
import { withLock } from "./lock";
import { ensureBootstrap } from "./seed";
import { getSpec, saveSpec, specLockKey } from "./specs";

const VERSIONS_LOCK = "versions";

async function load(): Promise<Version[]> {
  const raw = await readJson(paths.versions());
  return raw === null ? [] : VersionsFileSchema.parse(raw).versions;
}

const save = (versions: Version[]) => writeJsonAtomic(paths.versions(), { versions });

/** Drafts are hidden unless `includeDrafts` is set (admin views). */
export async function listVersions(opts: { includeDrafts?: boolean } = {}): Promise<Version[]> {
  await ensureBootstrap();
  const all = await load();
  return opts.includeDrafts ? all : all.filter((v) => v.status !== "draft");
}

export async function getVersion(
  name: string,
  opts: { includeDrafts?: boolean } = {},
): Promise<Version> {
  const v = (await listVersions(opts)).find((x) => x.name === name);
  if (!v) throw new NotFoundError(`Version "${name}" not found`);
  return v;
}

export async function getCurrentVersion(): Promise<Version | null> {
  const all = await listVersions();
  return all.find((v) => v.status === "current") ?? all[0] ?? null;
}

export interface CreateVersionInput {
  name: string;
  title?: string;
  cloneFrom?: string;
  status?: VersionStatus;
}

export async function createVersion(input: CreateVersionInput, actor: string): Promise<Version> {
  await ensureBootstrap();
  const name = VersionNameSchema.safeParse(input.name);
  if (!name.success) throw new ValidationError("Invalid version name", name.error.issues);

  const created = await withLock(VERSIONS_LOCK, async () => {
    const versions = await load();
    if (versions.some((v) => v.name === name.data)) {
      throw new ValidationError(`Version "${name.data}" already exists`);
    }
    const now = new Date().toISOString();
    const status: VersionStatus = input.status ?? (versions.length === 0 ? "current" : "draft");
    const version: Version = {
      name: name.data,
      title: input.title ?? name.data,
      status,
      createdAt: now,
      updatedAt: now,
    };

    const spec: Spec = input.cloneFrom
      ? cloneSpec(await getSpec(input.cloneFrom), name.data, actor, now)
      : { version: name.data, info: { title: version.title }, endpoints: [] };

    // Spec file first so versions.json never points at a missing file.
    await withLock(specLockKey(name.data), () => saveSpec(spec));
    await save(applyStatus([...versions, version], version.name, status, now));
    return version;
  });

  await appendAudit({
    user: actor,
    action: input.cloneFrom ? "clone" : "create",
    entity: "version",
    version: created.name,
    target: created.name,
    summary: input.cloneFrom
      ? `Cloned ${input.cloneFrom} → ${created.name}`
      : `Created ${created.name}`,
    meta: input.cloneFrom ? { from: input.cloneFrom } : undefined,
  });
  return created;
}

function cloneSpec(src: Spec, name: string, actor: string, now: string): Spec {
  return {
    version: name,
    info: { ...src.info },
    endpoints: src.endpoints.map((ep) => ({
      ...structuredClone(ep),
      id: randomUUID(),
      examples: ep.examples.map((ex) => ({ ...structuredClone(ex), id: randomUUID() })),
      createdAt: now,
      updatedAt: now,
      updatedBy: actor,
      revision: 1,
    })),
  };
}

/** Only one version may be current; promoting one demotes the previous current. */
function applyStatus(versions: Version[], name: string, status: VersionStatus, now: string) {
  return versions.map((v) => {
    if (v.name === name) return { ...v, status, updatedAt: now };
    if (status === "current" && v.status === "current") {
      return { ...v, status: "deprecated" as const, updatedAt: now };
    }
    return v;
  });
}

export async function updateVersion(
  name: string,
  patch: { title?: string; status?: VersionStatus },
  actor: string,
): Promise<Version> {
  await ensureBootstrap();
  const updated = await withLock(VERSIONS_LOCK, async () => {
    const versions = await load();
    const target = versions.find((v) => v.name === name);
    if (!target) throw new NotFoundError(`Version "${name}" not found`);
    if (target.status === "current" && patch.status && patch.status !== "current") {
      throw new ValidationError(
        "Set another version as current instead of demoting the current one",
      );
    }
    const now = new Date().toISOString();
    let next = versions.map((v) =>
      v.name === name && patch.title !== undefined
        ? { ...v, title: patch.title, updatedAt: now }
        : v,
    );
    if (patch.status) next = applyStatus(next, name, patch.status, now);
    await save(next);
    return next.find((v) => v.name === name)!;
  });
  await appendAudit({
    user: actor,
    action: "update",
    entity: "version",
    version: name,
    target: name,
    summary: `Updated ${name}`,
    meta: patch,
  });
  return updated;
}

export async function deleteVersion(name: string, actor: string): Promise<void> {
  await ensureBootstrap();
  await withLock(VERSIONS_LOCK, async () => {
    const versions = await load();
    const target = versions.find((v) => v.name === name);
    if (!target) throw new NotFoundError(`Version "${name}" not found`);
    if (target.status === "current") {
      throw new ValidationError(
        "Cannot delete the current version; set another version as current first",
      );
    }
    // versions.json first so the site never lists a version whose file is gone.
    await save(versions.filter((v) => v.name !== name));
    await withLock(specLockKey(name), () => fs.rm(paths.spec(name), { force: true }));
  });
  await appendAudit({
    user: actor,
    action: "delete",
    entity: "version",
    version: name,
    target: name,
    summary: `Deleted ${name}`,
  });
}
