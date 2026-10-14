import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { queryAudit } from "@/lib/audit/log";
import { SpecSchema } from "@/lib/schema";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/store/errors";
import { readJson, writeJsonAtomic } from "@/lib/store/fs-atomic";
import { withLock } from "@/lib/store/lock";
import {
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  getSpec,
  updateEndpoint,
} from "@/lib/store/specs";
import {
  createVersion,
  deleteVersion,
  getCurrentVersion,
  listVersions,
  updateVersion,
} from "@/lib/store/versions";
import { readAuditLines, sampleEndpoint, useTempDataDir } from "./helpers";

const ADMIN = "admin@example.com";

describe("fs-atomic", () => {
  const dir = useTempDataDir();

  it("writes and reads JSON without leaving temp files", async () => {
    const file = path.join(dir(), "nested", "x.json");
    await writeJsonAtomic(file, { a: 1 });
    await writeJsonAtomic(file, { a: 2 });
    expect(await readJson(file)).toEqual({ a: 2 });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["x.json"]);
  });

  it("returns null for a missing file", async () => {
    expect(await readJson(path.join(dir(), "nope.json"))).toBeNull();
  });
});

describe("lock", () => {
  useTempDataDir();

  it("serialises critical sections for the same key", async () => {
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        withLock("k", async () => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await new Promise((r) => setTimeout(r, 2));
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(1);
  });

  it("releases the lock when the callback throws", async () => {
    await expect(withLock("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    await expect(withLock("k", async () => "ok")).resolves.toBe("ok");
  });
});

describe("seed / bootstrap", () => {
  const dir = useTempDataDir();

  it("creates users.txt and seeds v1 into an empty DATA_DIR", async () => {
    const versions = await listVersions();
    expect(versions.map((v) => v.name)).toEqual(["v1"]);
    expect(fs.readFileSync(path.join(dir(), "users.txt"), "utf8")).toContain("admin@example.com:");

    const spec = await getSpec("v1");
    expect(SpecSchema.safeParse(spec).success).toBe(true);
    expect(new Set(spec.endpoints.map((e) => e.group))).toEqual(new Set(["Users", "Orders"]));
    expect(spec.endpoints).toHaveLength(4);
    for (const ep of spec.endpoints) {
      expect(ep.examples.some((x) => x.type === "success")).toBe(true);
      expect(ep.examples.some((x) => x.type === "fail")).toBe(true);
    }
  });

  it("does not overwrite an existing users.txt", async () => {
    fs.writeFileSync(path.join(dir(), "users.txt"), "me@x.com:secret\n");
    await listVersions();
    expect(fs.readFileSync(path.join(dir(), "users.txt"), "utf8")).toBe("me@x.com:secret\n");
  });
});

describe("endpoints", () => {
  const dir = useTempDataDir();

  it("creates an endpoint with revision 1, example ids and an audit line", async () => {
    const ep = await createEndpoint("v1", sampleEndpoint(), ADMIN);
    expect(ep.revision).toBe(1);
    expect(ep.updatedBy).toBe(ADMIN);
    expect(ep.examples.every((x) => x.id)).toBe(true);
    expect((await getEndpoint("v1", ep.id)).path).toBe("/products/{id}");

    const audit = readAuditLines(dir());
    expect(audit.at(-1)).toMatchObject({
      action: "create",
      entity: "endpoint",
      user: ADMIN,
      target: ep.id,
    });
  });

  it("rejects undeclared path params and duplicate routes", async () => {
    await expect(
      createEndpoint("v1", sampleEndpoint({ pathParams: [] }), ADMIN),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      createEndpoint(
        "v1",
        sampleEndpoint({
          path: "/users/{userId}",
          pathParams: [{ name: "userId", type: "string", required: true }],
        }),
        ADMIN,
      ),
    ).rejects.toThrow(/already exists/);
  });

  it("bumps the revision on update and rejects a stale revision with 409", async () => {
    const ep = await createEndpoint("v1", sampleEndpoint(), ADMIN);
    const updated = await updateEndpoint("v1", ep.id, sampleEndpoint({ summary: "New" }), 1, ADMIN);
    expect(updated.revision).toBe(2);
    expect(updated.createdAt).toBe(ep.createdAt);

    const stale = updateEndpoint(
      "v1",
      ep.id,
      sampleEndpoint({ summary: "Other" }),
      1,
      "b@example.com",
    );
    await expect(stale).rejects.toBeInstanceOf(ConflictError);
    await expect(stale).rejects.toMatchObject({ status: 409, current: { revision: 2 } });
    expect((await getEndpoint("v1", ep.id)).summary).toBe("New");
  });

  it("keeps existing example ids and reports example changes in the audit", async () => {
    const ep = await createEndpoint("v1", sampleEndpoint(), ADMIN);
    const [ok] = ep.examples;
    const next = await updateEndpoint(
      "v1",
      ep.id,
      sampleEndpoint({
        examples: [
          { ...ok, description: "edited" },
          { name: "Server error", type: "fail", response: { status: 500 } },
        ],
      }),
      1,
      ADMIN,
    );
    expect(next.examples[0].id).toBe(ok.id);
    expect(readAuditLines(dir()).at(-1).meta).toMatchObject({
      examplesAdded: 1,
      examplesRemoved: 1,
      examplesChanged: 1,
    });
  });

  it("deletes with revision check and audits it", async () => {
    const ep = await createEndpoint("v1", sampleEndpoint(), ADMIN);
    await expect(deleteEndpoint("v1", ep.id, 7, ADMIN)).rejects.toBeInstanceOf(ConflictError);
    await deleteEndpoint("v1", ep.id, 1, ADMIN);
    await expect(getEndpoint("v1", ep.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(readAuditLines(dir()).at(-1)).toMatchObject({ action: "delete", target: ep.id });
  });

  it("survives 50 concurrent creates without corrupting the spec file", async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        createEndpoint("v1", sampleEndpoint({ path: `/items/${i}`, pathParams: [] }), ADMIN),
      ),
    );
    const raw = JSON.parse(fs.readFileSync(path.join(dir(), "specs", "v1.json"), "utf8"));
    expect(SpecSchema.parse(raw).endpoints).toHaveLength(54);
    expect(readAuditLines(dir()).filter((l) => l.action === "create")).toHaveLength(50);
  });

  it("treats unsafe version names as not found", async () => {
    await expect(getSpec("../users")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("versions", () => {
  useTempDataDir();

  it("clones a version as a hidden draft with fresh ids and revision 1", async () => {
    const v1 = await getSpec("v1");
    const v2 = await createVersion({ name: "v2", title: "Version 2", cloneFrom: "v1" }, ADMIN);
    expect(v2.status).toBe("draft");
    expect((await listVersions()).map((v) => v.name)).toEqual(["v1"]);
    expect((await listVersions({ includeDrafts: true })).map((v) => v.name)).toEqual(["v1", "v2"]);

    const spec2 = await getSpec("v2");
    expect(spec2.endpoints).toHaveLength(v1.endpoints.length);
    expect(spec2.endpoints.every((e) => e.revision === 1)).toBe(true);
    expect(spec2.endpoints.map((e) => e.id)).not.toContain(v1.endpoints[0].id);
  });

  it("keeps exactly one current version", async () => {
    await createVersion({ name: "v2", cloneFrom: "v1" }, ADMIN);
    await updateVersion("v2", { status: "current" }, ADMIN);
    const all = await listVersions({ includeDrafts: true });
    expect(all.find((v) => v.name === "v1")?.status).toBe("deprecated");
    expect((await getCurrentVersion())?.name).toBe("v2");
    expect(all.filter((v) => v.status === "current")).toHaveLength(1);
  });

  it("refuses to delete the current version, deletes others", async () => {
    await expect(deleteVersion("v1", ADMIN)).rejects.toBeInstanceOf(ValidationError);
    await createVersion({ name: "v2" }, ADMIN);
    await deleteVersion("v2", ADMIN);
    await expect(getSpec("v2")).rejects.toBeInstanceOf(NotFoundError);

    const audit = await queryAudit({ entity: "version" });
    expect(audit.items.map((e) => e.action)).toEqual(["delete", "create"]);
  });

  it("rejects duplicate and unsafe names", async () => {
    await expect(createVersion({ name: "v1" }, ADMIN)).rejects.toThrow(/already exists/);
    await expect(createVersion({ name: "../evil" }, ADMIN)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("audit query", () => {
  useTempDataDir();

  it("filters by user/action and paginates newest first", async () => {
    for (let i = 0; i < 3; i++) {
      await createEndpoint("v1", sampleEndpoint({ path: `/a/${i}`, pathParams: [] }), ADMIN);
    }
    const ep = await createEndpoint("v1", sampleEndpoint(), "bob@example.com");
    await deleteEndpoint("v1", ep.id, 1, "bob@example.com");

    const bob = await queryAudit({ user: "bob" });
    expect(bob.items.map((e) => e.action)).toEqual(["delete", "create"]);

    const page = await queryAudit({ action: "create", page: 2, pageSize: 3 });
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].summary).toBe("GET /a/0");

    const future = await queryAudit({ from: "2999-01-01" });
    expect(future.total).toBe(0);
  });
});
