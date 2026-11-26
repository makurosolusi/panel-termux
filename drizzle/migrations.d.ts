// Types for drizzle/migrations.js, which drizzle-kit (driver durable-sqlite) regenerates on each `db:generate`.
declare const bundle: {
  journal: { entries: { idx: number; when: number; tag: string; breakpoints: boolean }[] };
  migrations: Record<string, string>;
};
export default bundle;
