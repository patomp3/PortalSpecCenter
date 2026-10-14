import { getSpec } from "@/lib/store/specs";
import { listVersions } from "@/lib/store/versions";

export const dynamic = "force-dynamic";

// Temporary Sprint 1 page: proves the data layer bootstraps DATA_DIR.
// Replaced by the public docs UI in Sprint 2.
export default async function Home() {
  const versions = await listVersions();
  const specs = await Promise.all(versions.map((v) => getSpec(v.name)));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">API Documentation Portal</h1>
      <p className="mt-2 text-sm opacity-70">Data layer check — the docs UI arrives in Sprint 2.</p>
      <ul className="mt-6 space-y-2">
        {specs.map((s, i) => (
          <li key={s.version} className="rounded border border-current/10 p-3">
            <span className="font-mono">{s.version}</span> ({versions[i].status}) — {s.info.title}:{" "}
            {s.endpoints.length} endpoints
          </li>
        ))}
      </ul>
    </main>
  );
}
