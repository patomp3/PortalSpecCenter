# API Documentation Portal — Design & Sprint Plan

> เอกสารนี้ใช้เป็นแหล่งอ้างอิงเดียวระหว่าง implement: สถาปัตยกรรม, data model, API, แผน sprint และ progress
> อัปเดตส่วน **Progress Tracker** ทุกครั้งที่จบงานย่อย/จบ sprint

---

## 0. Progress Tracker (ภาพรวม)

| Sprint | หัวข้อ | สถานะ | ความคืบหน้า | หมายเหตุ |
|---|---|---|---|---|
| S1 | โครงโปรเจกต์ + Data layer + Seed | ✅ Done | 12 / 12 | 18 tests ผ่าน, build ผ่าน |
| S2 | หน้า User (list / search / group / detail / examples) | ⬜ Not started | 0 / 11 | |
| S3 | Login + Admin CRUD endpoint / example | ⬜ Not started | 0 / 13 | |
| S4 | จัดการ Version + Audit Log | ⬜ Not started | 0 / 9 | |
| S5 | Export OpenAPI / Postman + Import | ⬜ Not started | 0 / 9 | |
| S6 | Docker, docker-compose, README | ⬜ Not started | 0 / 8 | |

สัญลักษณ์: ⬜ Not started · 🟨 In progress · ✅ Done · ⛔ Blocked

### Decisions
- [x] **ภาษา UI**: English — ข้อความ UI รวมไว้ที่ `src/i18n/en.ts` (เผื่อเพิ่มภาษาภายหลัง) *(ตัดสินใจ 2026-10-14)*
- [x] **Session**: เก็บในไฟล์ `DATA_DIR/sessions.json` เพื่อให้รีสตาร์ท container แล้วไม่หลุด login *(ตัดสินใจ 2026-10-14)*

---

## 1. เป้าหมายและขอบเขต

เว็บแสดง API spec พร้อมตัวอย่าง request/response ทั้ง success และ fail ที่ admin กรอกไว้ — **อ่านอย่างเดียวสำหรับ user**
ไม่มี mock server, ไม่มีการเรียก API จริง, ไม่มี database, ไม่มีระบบสมัครสมาชิก, role มีแค่ user (anonymous) / admin

### เกณฑ์ว่างานเสร็จ (Definition of Done ของทั้งโปรเจกต์)
1. User ที่ไม่ login เปิดดูได้ แต่เรียก `/api/admin/*` แล้วได้ **401**
2. Admin เพิ่ม endpoint พร้อม success + fail example แล้ว user เห็น**ทันที** (ไม่มี cache ค้าง)
3. ลบ/แก้ไขแล้วมีบรรทัดใน `audit.log`
4. OpenAPI ที่ export ผ่าน Swagger Editor และ Postman collection import เข้า Postman ได้
5. รีสตาร์ท container แล้วข้อมูลยังอยู่ (volume)

---

## 2. Tech Stack

| ส่วน | เลือกใช้ | เหตุผล |
|---|---|---|
| Framework | Next.js 14+ App Router, TypeScript (strict) | ตาม requirement |
| Styling | Tailwind CSS | ตาม requirement |
| Validation | `zod` | ใช้ schema เดียวกันทั้ง client form และ route handler |
| Syntax highlight | `shiki` (render ฝั่ง server) | ไม่ต้องส่ง JS highlight ไป client |
| JSON editor (admin) | CodeMirror 6 (`@uiw/react-codemirror` + `@codemirror/lang-json`) | เบากว่า Monaco, มี lint JSON |
| YAML | `js-yaml` | export/import OpenAPI YAML |
| ID / token | `crypto.randomUUID()` / `crypto.randomBytes` | ไม่ต้องเพิ่ม dependency |
| Test | `vitest` (data layer, export) | |
| Runtime | Node 20 LTS, `output: "standalone"` | Docker image เล็ก |

---

## 3. สถาปัตยกรรม

```
Browser ──► Next.js (Node runtime, single process)
              ├─ app/(public)/...        Server Components อ่าน data layer ตรง
              ├─ app/admin/...           Server Components + Client forms
              ├─ app/api/...             Route Handlers (public GET / admin CRUD)
              ├─ middleware.ts           เช็คว่ามี cookie session (เบื้องต้น)
              └─ src/lib/
                   ├─ store/             data layer: atomic write + lock + revision
                   ├─ auth/              users.txt, sessions
                   ├─ audit/             append JSON Lines
                   ├─ export/            openapi.ts, postman.ts
                   └─ import/            openapi → internal model
                       │
                       ▼
                  DATA_DIR (volume)
```

หลักการสำคัญ
- **Data layer เป็นทางเดียวที่แตะไฟล์** — page/route ห้ามใช้ `fs` ตรง
- หน้า public ใช้ `export const dynamic = "force-dynamic"` (หรือ `revalidatePath` หลังเขียน) เพื่อให้ user เห็นข้อมูลใหม่ทันที
- Route handler ทุกตัวที่แตะไฟล์ต้อง `export const runtime = "nodejs"`
- **Middleware รันบน Edge อ่านไฟล์ไม่ได้** → middleware ทำแค่เช็คว่ามี cookie แล้ว redirect; การตรวจ session จริงทำใน `requireAdmin()` ที่เรียกใน admin layout และทุก admin route handler

---

## 4. โครงสร้างโปรเจกต์

```
.
├─ src/
│  ├─ app/
│  │  ├─ layout.tsx
│  │  ├─ page.tsx                         # redirect → /docs/{currentVersion}
│  │  ├─ docs/[version]/
│  │  │  ├─ layout.tsx                    # sidebar + search + version switcher
│  │  │  ├─ page.tsx                      # รายการ endpoint
│  │  │  └─ [id]/page.tsx                 # รายละเอียด endpoint
│  │  ├─ admin/
│  │  │  ├─ login/page.tsx
│  │  │  ├─ layout.tsx                    # requireAdmin()
│  │  │  ├─ page.tsx                      # dashboard: เลือก version, รายการ endpoint
│  │  │  ├─ [version]/endpoints/new/page.tsx
│  │  │  ├─ [version]/endpoints/[id]/page.tsx
│  │  │  ├─ versions/page.tsx
│  │  │  ├─ audit/page.tsx
│  │  │  └─ import/page.tsx
│  │  └─ api/
│  │     ├─ versions/route.ts
│  │     ├─ specs/[version]/route.ts
│  │     ├─ specs/[version]/[id]/route.ts
│  │     ├─ export/[version]/route.ts
│  │     ├─ auth/login/route.ts           # POST (public)
│  │     ├─ auth/logout/route.ts          # POST
│  │     └─ admin/
│  │        ├─ versions/route.ts                      # POST
│  │        ├─ versions/[version]/route.ts            # PUT, DELETE
│  │        ├─ specs/[version]/endpoints/route.ts     # POST
│  │        ├─ specs/[version]/endpoints/[id]/route.ts# PUT, DELETE
│  │        ├─ import/[version]/route.ts              # POST
│  │        └─ audit/route.ts                         # GET
│  ├─ components/        # MethodBadge, CodeBlock, CopyButton, ConfirmDialog, JsonEditor ...
│  ├─ lib/
│  │  ├─ config.ts       # DATA_DIR
│  │  ├─ schema.ts       # zod schemas + TS types
│  │  ├─ store/{fs-atomic.ts, lock.ts, versions.ts, specs.ts, seed.ts}
│  │  ├─ auth/{users.ts, sessions.ts, require-admin.ts}
│  │  ├─ audit/log.ts
│  │  ├─ export/{openapi.ts, postman.ts, curl.ts}
│  │  └─ import/{openapi.ts, native.ts}
│  ├─ i18n/
│  └─ middleware.ts
├─ seed/                 # seed data ต้นฉบับ (copy เข้า DATA_DIR ตอนว่าง)
├─ data/                 # DATA_DIR ค่าเริ่มต้น (อยู่ใน .gitignore)
├─ tests/
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
└─ README.md
```

---

## 5. Data Files

```
DATA_DIR/
  users.txt          # email:password  (บรรทัดว่าง / ขึ้นต้นด้วย # = ข้าม)
  sessions.json      # { [token]: { email, createdAt, expiresAt } }
  versions.json
  specs/
    v1.json
  audit.log          # JSON Lines
  .locks/            # lock files (สร้างอัตโนมัติ)
```

### versions.json
```json
{
  "versions": [
    { "name": "v1", "title": "Version 1", "status": "current", "createdAt": "...", "updatedAt": "..." }
  ]
}
```
- `status`: `"current" | "deprecated" | "draft"` — `draft` ซ่อนจาก public (version ใหม่/clone เป็น draft โดยปริยาย ยกเว้นเป็น version แรก)
- มี `current` ได้ **ตัวเดียว**; หน้าแรก redirect ไปที่ current
- `name` ต้องตรง regex `^[a-zA-Z0-9._-]+$` (ใช้เป็นชื่อไฟล์ได้ปลอดภัย, กัน path traversal)

### specs/{version}.json
```json
{ "version": "v1", "info": { "title": "...", "description": "...", "baseUrl": "https://api.example.com" }, "endpoints": [ /* Endpoint[] */ ] }
```

### audit.log (หนึ่งบรรทัดต่อเหตุการณ์)
```json
{"ts":"2026-10-14T06:00:00.000Z","user":"admin@example.com","action":"update","entity":"endpoint","version":"v1","target":"<id>","summary":"PUT /users/{id}","meta":{"fromRevision":3,"toRevision":4}}
```
- `action`: `create | update | delete | login | logout | login_failed | import | clone`
- `entity`: `endpoint | example | version | session | spec`

---

## 6. Data Model (TypeScript / zod)

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Param {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  required: boolean;
  description?: string;
  example?: string;
}

interface RequestBody {
  contentType: string;            // "application/json"
  required: boolean;
  schemaMode: "jsonschema" | "fields";
  schema?: object;                // ถ้า schemaMode = jsonschema
  fields?: (Param & { children?: Param[] })[]; // ถ้า schemaMode = fields (แปลงเป็น JSON Schema ตอน export)
}

interface Example {
  id: string;
  name: string;
  type: "success" | "fail";
  description?: string;
  request: { headers?: Record<string,string>; query?: Record<string,string>; pathParams?: Record<string,string>; body?: unknown };
  response: { status: number; headers?: Record<string,string>; body?: unknown };
}

interface Endpoint {
  id: string;                     // uuid
  group: string;                  // tag/module
  method: HttpMethod;
  path: string;                   // "/users/{id}"
  summary: string;
  description?: string;           // markdown
  deprecated: boolean;
  headers: Param[];
  pathParams: Param[];
  queryParams: Param[];
  requestBody?: RequestBody;
  examples: Example[];
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  revision: number;               // เริ่มที่ 1, +1 ทุกครั้งที่เขียน
}
```

Validation rules (zod)
- `path` ขึ้นต้นด้วย `/`; ทุก `{param}` ใน path ต้องมีใน `pathParams` และกลับกัน
- `method + path` ห้ามซ้ำภายใน version เดียวกัน
- `response.status`: success → 1xx–3xx, fail → 4xx–5xx (เตือน ไม่ block)
- `examples` ไม่บังคับ แต่ UI แนะนำให้มีอย่างน้อย 1 success

---

## 7. Data Layer

### 7.1 Atomic write
```
writeJsonAtomic(file, data):
  tmp = `${file}.${pid}.${random}.tmp`
  write tmp → fsync → rename(tmp, file)
  (Windows: rename อาจได้ EPERM/EBUSY ถ้าไฟล์ถูกเปิดอยู่ → retry 5 ครั้ง backoff 20–100ms)
```

### 7.2 Lock
- **ชั้นที่ 1 (in-process):** mutex แบบ promise chain ต่อ key (ชื่อไฟล์) — กัน request พร้อมกันใน process เดียว
- **ชั้นที่ 2 (cross-process):** lock file `DATA_DIR/.locks/<key>.lock` สร้างด้วย `fs.open(path, "wx")`; ถ้ามีอยู่ให้รอ retry; lock เก่ากว่า 30s ถือว่า stale แล้วลบได้
- API: `withLock(key, async () => { read → modify → writeAtomic })` — ทุก write ต้องผ่านตัวนี้

### 7.3 Revision / optimistic concurrency
- Client ส่ง `revision` ที่โหลดมาไปกับ PUT/DELETE
- ภายใน lock: ถ้า `stored.revision !== body.revision` → ตอบ **409 Conflict** พร้อม `{ current: Endpoint }`
- UI แสดง banner "มีคนแก้ endpoint นี้ไปแล้ว (โดย X เมื่อ Y)" ให้เลือก *โหลดของล่าสุด* หรือ *ดู diff* — ไม่เขียนทับเงียบๆ
- การแก้ example ถือเป็นการแก้ endpoint (bump revision ของ endpoint)

### 7.4 Audit
- `appendAudit(event)` ใช้ `fs.appendFile` ภายใต้ lock `audit`
- เรียกใน data layer หลัง write สำเร็จ (ไม่ใช่ใน route) เพื่อให้ "ทุกการเขียนมี audit" เป็นจริงโดยโครงสร้าง

### 7.5 Bootstrap / Seed
ตอนเริ่ม (lazy, ครั้งแรกที่ data layer ถูกเรียก):
- ถ้าไม่มี `users.txt` → สร้างพร้อม `admin@example.com:admin123` + คอมเมนต์วิธีแก้, log warning ใน console
- ถ้าไม่มี `versions.json` → copy จาก `seed/` (v1, 2 groups, 4 endpoints)

Seed data:
| Group | Method | Path | Examples |
|---|---|---|---|
| Users | GET | `/users` | 200 list · 401 unauthorized |
| Users | GET | `/users/{id}` | 200 found · 404 not found |
| Orders | POST | `/orders` | 201 created · 400 bad request · 422 validation |
| Orders | DELETE | `/orders/{id}` | 204 deleted · 404 not found · 500 server error |

---

## 8. Authentication

- `POST /api/auth/login` `{ email, password }` → เทียบกับ `users.txt` (split ที่ `:` ตัวแรก; password มี `:` ได้)
- สำเร็จ: สร้าง token 32 bytes hex, บันทึก `sessions.json` (อายุ 7 วัน), set cookie `portal_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` เมื่อ `COOKIE_SECURE=true`)
- audit: `login` / `login_failed`
- `requireAdmin()`:
  - Route handler → ไม่มี/หมดอายุ → `401 { error: "unauthorized" }`
  - Page → `redirect("/admin/login?next=...")`
- `middleware.ts` matcher `/admin/:path*` (ยกเว้น `/admin/login`) และ `/api/admin/:path*` → ไม่มี cookie ก็ redirect/401 ทันที
- หน้า public **ไม่มีลิงก์/ปุ่มไป admin** และ component admin อยู่ใต้ `/admin` เท่านั้น

---

## 9. API

### Public (GET only)
| Route | Response |
|---|---|
| `GET /api/versions` | `versions[]` |
| `GET /api/specs/[version]` | spec ทั้งไฟล์ (endpoints + examples) |
| `GET /api/specs/[version]/[id]` | Endpoint เดียว |
| `GET /api/export/[version]?format=openapi-json\|openapi-yaml\|postman` | ไฟล์แนบ (`Content-Disposition: attachment`) |

### Auth
| `POST /api/auth/login` · `POST /api/auth/logout` |
|---|

### Admin (ต้องมี session, ไม่งั้น 401)
| Method | Route | หมายเหตุ |
|---|---|---|
| POST | `/api/admin/specs/[version]/endpoints` | สร้าง endpoint (รวม examples) |
| PUT | `/api/admin/specs/[version]/endpoints/[id]` | ต้องส่ง `revision` → 409 ถ้าไม่ตรง |
| DELETE | `/api/admin/specs/[version]/endpoints/[id]?revision=n` | |
| POST | `/api/admin/versions` | `{ name, title, cloneFrom? }` |
| PUT | `/api/admin/versions/[version]` | `{ title?, status? }` (ตั้ง current → ตัวเดิมกลายเป็น deprecated; ห้าม demote current ตรงๆ) |
| DELETE | `/api/admin/versions/[version]` | ห้ามลบ version ที่เป็น current (ต้องตั้งตัวอื่นเป็น current ก่อน) |
| POST | `/api/admin/import/[version]` | multipart file, `mode=merge\|replace` |
| GET | `/api/admin/audit?from=&to=&user=&action=&page=` | อ่านจากท้ายไฟล์, paginate |

Example CRUD ทำผ่าน PUT endpoint (ส่ง `examples[]` ทั้งชุด) — ลด route และให้ revision ครอบคลุมเสมอ
Error format กลาง: `{ error: string, details?: ZodIssue[] }` · status 400 / 401 / 404 / 409 / 500

---

## 10. หน้าจอ

### Public
- **Layout:** header (ชื่อ portal, version switcher, ปุ่ม Export ▾), sidebar ซ้าย (search + group พับได้ + method badge), content ขวา; มือถือ sidebar เป็น drawer
- **Method badge สี:** GET เขียว · POST น้ำเงิน · PUT ส้ม · PATCH ม่วง · DELETE แดง; deprecated = ขีดฆ่า + ป้าย
- **Search:** client-side filter ทันทีที่พิมพ์ บน method/path/summary/group (ส่งรายการ endpoint แบบย่อลง client ครั้งเดียว), shortcut `/` เพื่อ focus
- **Endpoint detail:** method + path, summary, description (markdown), ตาราง headers / path / query params, request body (schema เป็นตารางหรือ JSON), **Examples: tab Success | Fail** → แต่ละ example แสดง request (cURL + JSON) และ response (status badge + headers + body) พร้อมปุ่ม Copy
- cURL สร้างจาก `info.baseUrl + path` + example (ข้อความเท่านั้น ไม่มีการยิงจริง)
- Banner เมื่อดู version ที่ deprecated

### Admin
- `/admin/login`
- `/admin` — เลือก version, ตารางรายการ endpoint, ปุ่ม New / Edit / Delete
- Endpoint form: ส่วน General, Params (ตารางเพิ่ม/ลบแถว), Request Body (สลับ JSON Schema / ตารางฟิลด์), Examples (การ์ดแยก success/fail, เพิ่ม/แก้/ลบ/duplicate) — body ทุกช่องใช้ JsonEditor ที่แสดง syntax error และ block การบันทึกถ้า JSON ผิด
- `/admin/versions` — ตาราง version, Create (clone from ▾), Set current, Mark deprecated, Delete
- `/admin/audit` — ตาราง ts / user / action / entity / target / summary, filter วันที่ / ผู้ใช้ / ประเภท
- `/admin/import` — เลือก version, อัปโหลดไฟล์, preview จำนวน endpoint ที่จะเพิ่ม/ทับ, ยืนยัน
- **ทุกการลบใช้ `<ConfirmDialog>`** (แสดงชื่อสิ่งที่จะลบ)

---

## 11. Export / Import

### OpenAPI 3.0.3
- `info.title/version` จาก spec, `servers` จาก `baseUrl`, `tags` จาก group
- แต่ละ endpoint → `paths[path][method]`: `tags`, `summary`, `description`, `deprecated`, `operationId` (`${method}_${slug(path)}`), `parameters` (header/path/query), `requestBody`
- request examples → `requestBody.content[ct].examples[name]`
- response examples จัดกลุ่มตาม status → `responses[status].content["application/json"].examples[name]` (+ `description` จาก example แรก); response ที่ไม่มี body → ไม่มี `content`
- `fields` → แปลงเป็น JSON Schema; ทุก path param ต้อง `required: true`
- ตรวจด้วย `@apidevtools/swagger-parser` ใน test

### Postman Collection v2.1
- `info.schema = https://schema.getpostman.com/json/collection/v2.1.0/collection.json`
- folder ต่อ group → item ต่อ endpoint → `response[]` ต่อ example (`originalRequest`, `code`, `status`, `body`)
- `{{baseUrl}}` เป็น collection variable, path `{id}` → `:id`

### Import
- รองรับ: (1) ไฟล์ native ของระบบ (`specs/*.json` format) (2) OpenAPI 3.x JSON/YAML
- OpenAPI → แปลง tags→group, parameters, requestBody schema, `examples` → Example (status <400 = success)
- mode `merge` (จับคู่ด้วย method+path แล้วทับ) หรือ `replace` (แทนทั้ง version); audit `import` พร้อมจำนวน

---

## 12. Sprint Plan & Progress

> หลังจบแต่ละ sprint: ติ๊ก checklist, อัปเดตตารางในหัวข้อ 0, และเขียน "สรุป + วิธีทดสอบ" ใน Sprint log ด้านล่าง

### Sprint 1 — โครงโปรเจกต์ + Data layer + Seed  `✅`
**เป้าหมาย:** มีโปรเจกต์รันได้และ data layer ที่เชื่อถือได้
- [x] S1-01 `create-next-app` (TS, Tailwind, App Router, src/), ESLint, Prettier
- [x] S1-02 `next.config` → `output: "standalone"`; `.env.example` (`DATA_DIR`, `COOKIE_SECURE`, `PORT`)
- [x] S1-03 `lib/config.ts` อ่าน `DATA_DIR` (default `./data`, resolve absolute)
- [x] S1-04 `lib/schema.ts` zod schemas + types (Version, Spec, Endpoint, Example, Param, AuditEvent)
- [x] S1-05 `store/fs-atomic.ts` writeJsonAtomic + readJson (+ retry บน Windows)
- [x] S1-06 `store/lock.ts` in-process mutex + lock file + stale detection
- [x] S1-07 `store/versions.ts`, `store/specs.ts` (CRUD + revision check → `ConflictError`)
- [x] S1-08 `audit/log.ts` append + query (filter/paginate)
- [x] S1-09 `store/seed.ts` bootstrap users.txt / versions.json / specs จาก `seed/`
- [x] S1-10 เขียน seed data (1 version, 2 group, 4 endpoint, มีทั้ง success/fail)
- [x] S1-11 vitest: atomic write, concurrent write 50 ครั้งไม่เสียไฟล์, revision conflict, seed
- [x] S1-12 `.gitignore` (`data/`, `.next`, `node_modules`)

**ทดสอบ:** `npm run test` ผ่าน · `npm run dev` แล้วลบ `data/` → เปิดเว็บ → `data/` ถูกสร้างพร้อม seed

### Sprint 2 — หน้า User  `⬜`
**เป้าหมาย:** user อ่าน spec ได้ครบบน desktop และมือถือ
- [ ] S2-01 Public API: `/api/versions`, `/api/specs/[version]`, `/api/specs/[version]/[id]`
- [ ] S2-02 `/` redirect → current version; `/docs/[version]` layout + version switcher
- [ ] S2-03 Sidebar จัดกลุ่มตาม group + MethodBadge + active state
- [ ] S2-04 Search real-time (method/path/summary/group) + shortcut `/`
- [ ] S2-05 Endpoint list page (การ์ด/ตารางแยกตาม group)
- [ ] S2-06 Endpoint detail: params tables, request body (schema table / JSON)
- [ ] S2-07 Examples tab Success | Fail, แสดง request / response + status badge
- [ ] S2-08 CodeBlock (shiki) + CopyButton (JSON และ cURL), `lib/export/curl.ts`
- [ ] S2-09 Responsive: sidebar drawer บนมือถือ, code block scroll แนวนอน
- [ ] S2-10 Deprecated banner (version / endpoint), 404 page
- [ ] S2-11 ตัดสินใจภาษา UI + ตั้ง `i18n`

**ทดสอบ:** เปิด `/` → เห็น v1, ค้นหา "orders" เหลือ 2 รายการ, เข้า `DELETE /orders/{id}` สลับ tab Fail เห็น 404/500, copy cURL ได้, DevTools mobile 375px ใช้งานได้

### Sprint 3 — Login + Admin CRUD endpoint/example  `⬜`
**เป้าหมาย:** admin แก้ข้อมูลได้, user เห็นทันที, ป้องกันชนกัน
- [ ] S3-01 `auth/users.ts` parse users.txt; `auth/sessions.ts` (file-based, expiry)
- [ ] S3-02 `/api/auth/login`, `/api/auth/logout` + audit login/login_failed/logout
- [ ] S3-03 `middleware.ts` + `requireAdmin()` (page redirect / API 401)
- [ ] S3-04 หน้า `/admin/login` (+ `?next=`)
- [ ] S3-05 Admin layout (nav: Endpoints / Versions / Audit / Import / Logout)
- [ ] S3-06 `/admin` รายการ endpoint ตาม version
- [ ] S3-07 Admin API: POST / PUT / DELETE endpoint (zod validate, revision, audit)
- [ ] S3-08 Endpoint form: general + params table + request body
- [ ] S3-09 `JsonEditor` (CodeMirror + lint) block save ถ้า JSON ผิด
- [ ] S3-10 Examples editor: เพิ่ม/แก้/ลบ/duplicate, แยก success/fail
- [ ] S3-11 ConfirmDialog สำหรับลบ endpoint/example
- [ ] S3-12 409 Conflict UI (banner + reload ล่าสุด)
- [ ] S3-13 `revalidatePath` / force-dynamic ให้หน้า public อัปเดตทันที

**ทดสอบ:** `curl -i localhost:3000/api/admin/audit` → 401 · login → สร้าง endpoint ที่มี 1 success + 1 fail → เปิดหน้า public เห็นทันที · เปิด 2 แท็บแก้ endpoint เดียวกัน บันทึกแท็บที่ 2 → ได้ 409 · `audit.log` มีบรรทัด create/update/delete

### Sprint 4 — จัดการ Version + Audit Log  `⬜`
- [ ] S4-01 Admin API versions: create (clone), update (status/title), delete
- [ ] S4-02 Clone: copy endpoints ทั้งหมด, สร้าง id ใหม่, reset revision = 1
- [ ] S4-03 กฎ current มีตัวเดียว; ห้ามลบ current ถ้าเหลือ version เดียว
- [ ] S4-04 หน้า `/admin/versions` + ConfirmDialog ตอนลบ
- [ ] S4-05 Version switcher ฝั่ง public แสดงสถานะ (current / deprecated)
- [ ] S4-06 `/api/admin/audit` filter from/to/user/action + paginate (อ่านจากท้ายไฟล์)
- [ ] S4-07 หน้า `/admin/audit` ตาราง + filter
- [ ] S4-08 ตรวจว่าทุก write path เรียก audit (test ไล่ทุก action)
- [ ] S4-09 Audit สำหรับ version create/clone/update/delete

**ทดสอบ:** สร้าง v2 clone จาก v1 → ตั้ง v2 current → `/` ไป v2, v1 แสดง deprecated banner · ลบ v1 มี confirm · หน้า audit กรอง action=delete ได้

### Sprint 5 — Export + Import  `⬜`
- [ ] S5-01 `export/openapi.ts` (JSON) + `fields` → JSON Schema
- [ ] S5-02 OpenAPI YAML (`js-yaml`)
- [ ] S5-03 `export/postman.ts` v2.1 (folders, saved responses, `{{baseUrl}}`)
- [ ] S5-04 `/api/export/[version]` + ปุ่ม Export ▾ บน header
- [ ] S5-05 Test: validate ด้วย swagger-parser, ตรวจ Postman schema
- [ ] S5-06 `import/native.ts` + `import/openapi.ts` (JSON/YAML)
- [ ] S5-07 `/api/admin/import/[version]` (merge/replace) + audit
- [ ] S5-08 หน้า `/admin/import` พร้อม preview + confirm
- [ ] S5-09 Round-trip test: export → import → ข้อมูลเท่าเดิม (ยกเว้น id/meta)

**ทดสอบ:** ดาวน์โหลด openapi.yaml → วางใน https://editor.swagger.io ไม่มี error · import postman.json เข้า Postman เห็น folder + saved examples · import petstore OpenAPI ตัวอย่างเข้า v2 ได้

### Sprint 6 — Docker + README  `⬜`
- [ ] S6-01 Dockerfile multi-stage (deps → build → runner `node:20-alpine`, non-root user)
- [ ] S6-02 `DATA_DIR=/data`, `VOLUME /data`, copy `seed/` เข้า image สำหรับ bootstrap
- [ ] S6-03 `docker-compose.yml` (port 3000, volume `./data:/data`, `restart: unless-stopped`, healthcheck)
- [ ] S6-04 `.dockerignore`
- [ ] S6-05 README: รันในเครื่อง, env, Docker deploy
- [ ] S6-06 README: เปลี่ยน admin / เพิ่ม user ใน `users.txt`
- [ ] S6-07 README: backup/restore โฟลเดอร์ data (tar ตอน container ทำงาน — ปลอดภัยเพราะ atomic rename)
- [ ] S6-08 ทดสอบ DoD ทั้ง 5 ข้อบน container

**ทดสอบ:** `docker compose up -d --build` → เพิ่ม endpoint → `docker compose restart` → ข้อมูลยังอยู่ · `docker compose down && up` → ยังอยู่

---

## 13. Sprint Log

> บันทึกเมื่อจบแต่ละ sprint: ทำอะไรไปแล้ว / รันทดสอบอย่างไร / ปัญหาที่เจอ / สิ่งที่เลื่อนออกไป

### S1 — ✅ Done (2026-10-14)
**ทำแล้ว**
- Next.js 14.2 (App Router, TS strict, Tailwind, ESLint, Prettier), `output: "standalone"`, `.env.example` (`DATA_DIR`, `SEED_DIR`, `COOKIE_SECURE`, `PORT`)
- `src/lib/schema.ts` — zod schemas + types ทั้งหมด; ตรวจว่า `{param}` ใน path ตรงกับ `pathParams`
- `src/lib/store/fs-atomic.ts` — temp → fsync → rename (retry EPERM/EBUSY บน Windows)
- `src/lib/store/lock.ts` — promise queue ต่อ key + lock file `O_EXCL` (stale 30s, timeout 10s → 503)
- `src/lib/store/specs.ts` — get/create/update/delete endpoint, revision check → `ConflictError` (409 พร้อมข้อมูลล่าสุด), กัน route ซ้ำ (`/users/{id}` = `/users/{userId}`), `updateSpecInfo`
- `src/lib/store/versions.ts` — list/create/clone/update/delete version (ทำ data layer ของ S4 ล่วงหน้า), current มีตัวเดียว
- `src/lib/audit/log.ts` — append JSON Lines + query (from/to/user/action/entity, paginate, newest first)
- `src/lib/store/seed.ts` — bootstrap ครั้งแรก: สร้าง `users.txt` (admin@example.com) + copy `seed/`
- Seed: v1 "Example Shop API" — Users (GET /users, GET /users/{id}), Orders (POST /orders, DELETE /orders/{id}); examples 200/201/204 + 400/401/404/422/500
- หน้า `/` ชั่วคราว แสดง version + จำนวน endpoint (แทนที่ใน S2)

**ทดสอบ**
- `npm test` → 18 tests ผ่าน (atomic write, lock, seed, CRUD, 409 conflict, 50 concurrent creates, version clone/current/delete, audit query, path traversal)
- `npx tsc --noEmit`, `npm run lint`, `npm run build` ผ่าน
- ลบ `data/` → `npm run dev` → เปิด http://localhost:3000 → `data/` ถูกสร้างพร้อม `users.txt`, `versions.json`, `specs/v1.json`

**เปลี่ยนจากแผน / หมายเหตุ**
- เพิ่ม version status `draft` (ซ่อนจาก public) — version ที่ clone ใหม่เป็น draft จนกว่าจะตั้ง current/deprecated
- Example CRUD ทำผ่าน PUT endpoint ทั้งก้อน (revision ครอบคลุม) และ audit บันทึก examplesAdded/Removed/Changed
- `queryAudit` อ่านทั้งไฟล์ (พอสำหรับขนาดตอนนี้) — ถ้าไฟล์ใหญ่มากค่อยเปลี่ยนเป็นอ่านจากท้าย
- `next start` เตือนเรื่อง standalone แต่ยังใช้ได้; Docker (S6) จะรัน `node server.js`
### S2 — (ยังไม่เริ่ม)
### S3 — (ยังไม่เริ่ม)
### S4 — (ยังไม่เริ่ม)
### S5 — (ยังไม่เริ่ม)
### S6 — (ยังไม่เริ่ม)

---

## 14. ความเสี่ยงและข้อควรระวัง

| ความเสี่ยง | การรับมือ |
|---|---|
| Next.js cache ทำให้ user ไม่เห็นข้อมูลใหม่ | force-dynamic บนหน้า docs + `revalidatePath` หลังเขียน |
| `fs.rename` บน Windows ล้มเหลวเมื่อไฟล์ถูกเปิด | retry with backoff ใน `writeJsonAtomic` |
| Middleware (Edge) อ่านไฟล์ไม่ได้ | ตรวจ session จริงใน `requireAdmin()` ฝั่ง Node |
| Path traversal ผ่านชื่อ version | regex บังคับชื่อ version ทุกจุดที่ประกอบ path |
| audit.log โตเรื่อยๆ | อ่านจากท้ายไฟล์ + paginate; แนะนำ rotate ใน README |
| Password เก็บ plain text | ยอมรับตาม requirement (ไม่เน้น security) — ระบุชัดใน README |
