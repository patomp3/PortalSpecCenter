import fs from "node:fs/promises";
import path from "node:path";
import { paths } from "@/lib/config";
import { AuditEventSchema, type AuditAction, type AuditEvent } from "@/lib/schema";
import { readText } from "@/lib/store/fs-atomic";
import { withLock } from "@/lib/store/lock";

export async function appendAudit(event: Omit<AuditEvent, "ts">): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n";
  const file = paths.audit();
  await withLock("audit", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, line, "utf8");
  });
}

export interface AuditQuery {
  from?: string; // ISO date or datetime, inclusive
  to?: string; // ISO date or datetime; a bare date includes the whole day
  user?: string;
  action?: AuditAction;
  entity?: AuditEvent["entity"];
  page?: number;
  pageSize?: number;
}

export interface AuditPage {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}

/** Newest first. Malformed lines are skipped rather than failing the whole page. */
export async function queryAudit(q: AuditQuery = {}): Promise<AuditPage> {
  const text = (await readText(paths.audit())) ?? "";
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, q.pageSize ?? 50));
  const from = q.from ? Date.parse(q.from) : -Infinity;
  const to = q.to
    ? Date.parse(q.to) + (/^\d{4}-\d{2}-\d{2}$/.test(q.to) ? 86_400_000 - 1 : 0)
    : Infinity;
  const user = q.user?.toLowerCase();

  const matches: AuditEvent[] = [];
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let ev: AuditEvent;
    try {
      const parsed = AuditEventSchema.safeParse(JSON.parse(lines[i]));
      if (!parsed.success) continue;
      ev = parsed.data;
    } catch {
      continue;
    }
    const t = Date.parse(ev.ts);
    if (t < from || t > to) continue;
    if (user && !ev.user.toLowerCase().includes(user)) continue;
    if (q.action && ev.action !== q.action) continue;
    if (q.entity && ev.entity !== q.entity) continue;
    matches.push(ev);
  }

  const start = (page - 1) * pageSize;
  return { items: matches.slice(start, start + pageSize), total: matches.length, page, pageSize };
}
