import { z } from "zod";

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const PARAM_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const;

/** Version names double as file names, so keep them strictly safe. */
export const VERSION_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export const VersionNameSchema = z
  .string()
  .regex(VERSION_NAME_RE, "Use letters, digits, '.', '_' or '-' (max 64 chars)");

const StringMap = z.record(z.string(), z.string());

export const ParamSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  type: z.enum(PARAM_TYPES).default("string"),
  required: z.boolean().default(false),
  description: z.string().optional(),
  example: z.string().optional(),
});

export const FieldSchema: z.ZodType<Field, z.ZodTypeDef, unknown> = ParamSchema.extend({
  children: z.lazy(() => z.array(FieldSchema)).optional(),
});

export const RequestBodySchema = z.object({
  contentType: z.string().min(1).default("application/json"),
  required: z.boolean().default(false),
  schemaMode: z.enum(["jsonschema", "fields"]).default("fields"),
  schema: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(FieldSchema).optional(),
});

export const ExampleInputSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1, "Example name is required"),
  type: z.enum(["success", "fail"]),
  description: z.string().optional(),
  request: z
    .object({
      headers: StringMap.optional(),
      query: StringMap.optional(),
      pathParams: StringMap.optional(),
      body: z.unknown().optional(),
    })
    .default({}),
  response: z.object({
    status: z.number().int().min(100).max(599),
    headers: StringMap.optional(),
    body: z.unknown().optional(),
  }),
});

export const ExampleSchema = ExampleInputSchema.extend({ id: z.string().min(1) });

/** Names inside `{...}` in a path template, e.g. "/users/{id}" -> ["id"]. */
export function pathParamNames(path: string): string[] {
  return Array.from(path.matchAll(/\{([^}/]+)\}/g), (m) => m[1]);
}

const EndpointFields = {
  group: z.string().trim().min(1, "Group is required"),
  method: z.enum(HTTP_METHODS),
  path: z
    .string()
    .trim()
    .regex(/^\/\S*$/, "Path must start with '/' and contain no spaces"),
  summary: z.string().trim().min(1, "Summary is required"),
  description: z.string().optional(),
  deprecated: z.boolean().default(false),
  headers: z.array(ParamSchema).default([]),
  pathParams: z.array(ParamSchema).default([]),
  queryParams: z.array(ParamSchema).default([]),
  requestBody: RequestBodySchema.optional(),
};

function checkPathParams(
  ep: { path: string; pathParams: { name: string }[] },
  ctx: z.RefinementCtx,
) {
  const inPath = new Set(pathParamNames(ep.path));
  const declared = new Set(ep.pathParams.map((p) => p.name));
  for (const name of Array.from(inPath)) {
    if (!declared.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathParams"],
        message: `Path parameter "{${name}}" is not declared in pathParams`,
      });
    }
  }
  for (const name of Array.from(declared)) {
    if (!inPath.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pathParams"],
        message: `pathParams "${name}" does not appear in the path`,
      });
    }
  }
}

/** What an admin submits when creating/updating an endpoint. */
export const EndpointInputSchema = z
  .object({ ...EndpointFields, examples: z.array(ExampleInputSchema).default([]) })
  .superRefine(checkPathParams);

export const EndpointSchema = z
  .object({
    id: z.string().min(1),
    ...EndpointFields,
    examples: z.array(ExampleSchema).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    updatedBy: z.string(),
    revision: z.number().int().min(1),
  })
  .superRefine(checkPathParams);

export const SpecInfoSchema = z.object({
  title: z.string().default("API"),
  description: z.string().optional(),
  baseUrl: z.string().optional(),
});

export const SpecSchema = z.object({
  version: VersionNameSchema,
  info: SpecInfoSchema.default({}),
  endpoints: z.array(EndpointSchema).default([]),
});

export const VERSION_STATUSES = ["current", "deprecated", "draft"] as const;

export const VersionSchema = z.object({
  name: VersionNameSchema,
  title: z.string().default(""),
  // draft = hidden from the public site (e.g. a freshly cloned version being prepared)
  status: z.enum(VERSION_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const VersionsFileSchema = z.object({ versions: z.array(VersionSchema) });

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "login_failed",
  "import",
  "clone",
] as const;
export const AUDIT_ENTITIES = ["endpoint", "example", "version", "session", "spec"] as const;

export const AuditEventSchema = z.object({
  ts: z.string(),
  user: z.string(),
  action: z.enum(AUDIT_ACTIONS),
  entity: z.enum(AUDIT_ENTITIES),
  version: z.string().optional(),
  target: z.string().optional(),
  summary: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type HttpMethod = (typeof HTTP_METHODS)[number];
export type Param = z.infer<typeof ParamSchema>;
export interface Field extends Param {
  children?: Field[];
}
export type RequestBody = z.infer<typeof RequestBodySchema>;
export type ExampleInput = z.input<typeof ExampleInputSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type EndpointInput = z.input<typeof EndpointInputSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type SpecInfo = z.infer<typeof SpecInfoSchema>;
export type Spec = z.infer<typeof SpecSchema>;
export type Version = z.infer<typeof VersionSchema>;
export type VersionStatus = Version["status"];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
export type AuditEvent = z.infer<typeof AuditEventSchema>;
