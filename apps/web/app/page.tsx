import { getApiHealth } from "../lib/api";

export default async function HomePage() {
  const health = await getApiHealth();

  return (
    <main>
      <section className="shell">
        <p className="eyebrow">Nimbus M1 Foundation</p>
        <h1>API-first storage infrastructure, starting with a runnable foundation.</h1>
        <p className="summary">
          This milestone wires the web console, Express API, worker skeleton, PostgreSQL, Redis,
          MinIO, typed config, structured logging, and test auth boundaries. Product storage
          workflows start in later milestones.
        </p>
        <div className="status" aria-label="API health">
          <strong>API health</strong>
          <span>Status: {health.status}</span>
          <span>Service: {health.service ?? "not connected"}</span>
        </div>
      </section>
    </main>
  );
}
