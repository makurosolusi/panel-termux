// Compiles the panel (server + embedded SPA) into one executable.
// Usage: bun scripts/build.ts <bun-compile-target|local> <outfile>
import tailwind from "bun-plugin-tailwind";

const [target, outfile] = process.argv.slice(2);
if (!target || !outfile) {
  console.error("usage: bun scripts/build.ts <bun-linux-arm64-android|local> <outfile>");
  process.exit(2);
}

const result = await Bun.build({
  // PLAN/07 K1: thin entry; CLI commands load lazily and never evaluate the server bundle (lab L5)
  entrypoints: ["./src/server/main.ts"],
  compile: {
    ...(target === "local" ? {} : { target: target as Bun.Build.CompileTarget }),
    outfile,
    autoloadBunfig: false,
  },
  minify: true,
  // PLAN/01 §3.11: the SPA splits into entry (landing + session), `login` and `app` chunks
  splitting: true,
  plugins: [tailwind],
  loader: { ".sql": "text" },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.info(`built ${outfile} (${target})`);
