import { randomUUID } from "node:crypto";
import { appendAudit } from "@/lib/audit/log";
import { paths } from "@/lib/config";
import {
  EndpointInputSchema,
  SpecInfoSchema,
  SpecSchema,
  VERSION_NAME_RE,
  type Endpoint,
  type EndpointInput,
  type Example,
  type Spec,
  type SpecInfo,
} from "@/lib/schema";
import { ConflictError, NotFoundError, ValidationError } from "./errors";
import { readJson, writeJsonAtomic } from "./fs-atomic";
import { withLock } from "./lock";
import { ensureBootstrap } from "./seed";

export const specLockKey = (version: string) => `spec-${version}`;

function assertVersionName(version: string) {
  // Guards every path built from user input against traversal.
  if (!VERSION_NAME_RE.test(version)) throw new NotFoundError(`Version "${version}" not found`);
}

async function loadSpec(version: string): Promise<Spec> {
  assertVersionName(version);
  const raw = await readJson(paths.spec(version));
  if (raw === null) throw new NotFoundError(`Version "${version}" not found`);
  return SpecSchema.parse(raw);
}

export async function saveSpec(spec: Spec): Promise<void> {
  await writeJsonAtomic(paths.spec(spec.version), spec);
}

export async function getSpec(version: string): Promise<Spec> {
  await ensureBootstrap();
  return loadSpec(version);
}

export async function getEndpoint(version: string, id: string): Promise<Endpoint> {
  const spec = await getSpec(version);
  const ep = spec.endpoints.find((e) => e.id === id);
  if (!ep) throw new NotFoundError(`Endpoint "${id}" not found`);
  return ep;
}

function parseInput(input: unknown) {
  const parsed = EndpointInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid endpoint", parsed.error.issues);
  return parsed.data;
}

/** "/users/{id}" and "/users/{userId}" are the same route. */
const routeKey = (method: string, path: string) =>
  `${method} ${path.replace(/\{[^}/]+\}/g, "{}").replace(/\/+$/, "") || "/"}`;

function assertUniqueRoute(spec: Spec, method: string, path: string, exceptId?: string) {
  const key = routeKey(method, path);
  const clash = spec.endpoints.find((e) => e.id !== exceptId && routeKey(e.method, e.path) === key);
  if (clash) {
    throw new ValidationError(`${method} ${path} already exists in ${spec.version}`, [
      { code: "custom", path: ["path"], message: `Conflicts with ${clash.method} ${clash.path}` },
    ]);
  }
}

const withIds = (examples: ReturnType<typeof parseInput>["examples"]): Example[] =>
  examples.map((ex) => ({ ...ex, id: ex.id || randomUUID() }));

export async function createEndpoint(
  version: string,
  input: EndpointInput,
  actor: string,
): Promise<Endpoint> {
  await ensureBootstrap();
  const data = parseInput(input);
  const ep = await withLock(specLockKey(version), async () => {
    const spec = await loadSpec(version);
    assertUniqueRoute(spec, data.method, data.path);
    const now = new Date().toISOString();
    const created: Endpoint = {
      ...data,
      id: randomUUID(),
      examples: withIds(data.examples),
      createdAt: now,
      updatedAt: now,
      updatedBy: actor,
      revision: 1,
    };
    spec.endpoints.push(created);
    await saveSpec(spec);
    return created;
  });
  await appendAudit({
    user: actor,
    action: "create",
    entity: "endpoint",
    version,
    target: ep.id,
    summary: `${ep.method} ${ep.path}`,
    meta: { examples: ep.examples.length },
  });
  return ep;
}

/** Throws ConflictError (with the stored endpoint) when `expectedRevision` is stale. */
export async function updateEndpoint(
  version: string,
  id: string,
  input: EndpointInput,
  expectedRevision: number,
  actor: string,
): Promise<Endpoint> {
  await ensureBootstrap();
  const data = parseInput(input);
  const { before, after } = await withLock(specLockKey(version), async () => {
    const spec = await loadSpec(version);
    const idx = spec.endpoints.findIndex((e) => e.id === id);
    if (idx < 0) throw new NotFoundError(`Endpoint "${id}" not found`);
    const current = spec.endpoints[idx];
    if (current.revision !== expectedRevision) {
      throw new ConflictError(
        `Endpoint was modified by ${current.updatedBy} at ${current.updatedAt}`,
        current,
      );
    }
    assertUniqueRoute(spec, data.method, data.path, id);
    const updated: Endpoint = {
      ...data,
      id,
      examples: withIds(data.examples),
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
      revision: current.revision + 1,
    };
    spec.endpoints[idx] = updated;
    await saveSpec(spec);
    return { before: current, after: updated };
  });
  await appendAudit({
    user: actor,
    action: "update",
    entity: "endpoint",
    version,
    target: id,
    summary: `${after.method} ${after.path}`,
    meta: {
      fromRevision: before.revision,
      toRevision: after.revision,
      ...exampleDiff(before.examples, after.examples),
    },
  });
  return after;
}

function exampleDiff(before: Example[], after: Example[]) {
  const b = new Map(before.map((e) => [e.id, JSON.stringify(e)]));
  const a = new Set(after.map((e) => e.id));
  return {
    examplesAdded: after.filter((e) => !b.has(e.id)).length,
    examplesRemoved: before.filter((e) => !a.has(e.id)).length,
    examplesChanged: after.filter((e) => b.has(e.id) && b.get(e.id) !== JSON.stringify(e)).length,
  };
}

export async function deleteEndpoint(
  version: string,
  id: string,
  expectedRevision: number,
  actor: string,
): Promise<void> {
  await ensureBootstrap();
  const removed = await withLock(specLockKey(version), async () => {
    const spec = await loadSpec(version);
    const ep = spec.endpoints.find((e) => e.id === id);
    if (!ep) throw new NotFoundError(`Endpoint "${id}" not found`);
    if (ep.revision !== expectedRevision) {
      throw new ConflictError(`Endpoint was modified by ${ep.updatedBy} at ${ep.updatedAt}`, ep);
    }
    spec.endpoints = spec.endpoints.filter((e) => e.id !== id);
    await saveSpec(spec);
    return ep;
  });
  await appendAudit({
    user: actor,
    action: "delete",
    entity: "endpoint",
    version,
    target: id,
    summary: `${removed.method} ${removed.path}`,
    meta: { revision: removed.revision },
  });
}

export async function updateSpecInfo(
  version: string,
  info: Partial<SpecInfo>,
  actor: string,
): Promise<SpecInfo> {
  await ensureBootstrap();
  const next = await withLock(specLockKey(version), async () => {
    const spec = await loadSpec(version);
    const parsed = SpecInfoSchema.safeParse({ ...spec.info, ...info });
    if (!parsed.success) throw new ValidationError("Invalid spec info", parsed.error.issues);
    spec.info = parsed.data;
    await saveSpec(spec);
    return spec.info;
  });
  await appendAudit({
    user: actor,
    action: "update",
    entity: "spec",
    version,
    summary: "Spec info",
  });
  return next;
}
