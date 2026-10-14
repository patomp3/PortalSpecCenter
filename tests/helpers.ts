import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { EndpointInput } from "@/lib/schema";

/** Point DATA_DIR at a fresh temp folder for each test. */
export function useTempDataDir(): () => string {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-test-"));
    process.env.DATA_DIR = dir;
    process.env.SEED_DIR = path.resolve(__dirname, "..", "seed");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}

export function sampleEndpoint(overrides: Partial<EndpointInput> = {}): EndpointInput {
  return {
    group: "Products",
    method: "GET",
    path: "/products/{id}",
    summary: "Get product",
    pathParams: [{ name: "id", type: "string", required: true }],
    examples: [
      { name: "Found", type: "success", response: { status: 200, body: { id: "p1" } } },
      { name: "Missing", type: "fail", response: { status: 404, body: { error: "not found" } } },
    ],
    ...overrides,
  };
}

export function readAuditLines(dir: string) {
  const file = path.join(dir, "audit.log");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
