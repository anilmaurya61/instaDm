// Container entrypoint for the worker image.
//
// Applies pending Prisma migrations against the shared database before the
// worker starts, so a plain redeploy picks up new migrations. Set
// MIGRATE_ON_START=false to skip the migration step (for example when another
// process owns migrations, or when several replicas start at the same time).
//
// The image is distroless, so there is no shell: everything is spawned from
// this single Node process.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const workerEntry = join(root, "dist", "worker.mjs");

const signals = ["SIGINT", "SIGTERM"];

function forwardTo(child) {
  for (const signal of signals) {
    process.on(signal, () => child.kill(signal));
  }
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    forwardTo(child);
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `${label} exited ${signal ? `after ${signal}` : `with code ${code}`}`
        )
      );
    });
  });
}

async function main() {
  if (process.env.MIGRATE_ON_START === "false") {
    console.log("[migrate] MIGRATE_ON_START=false, skipping migrations");
  } else {
    console.log("[migrate] applying pending migrations");
    await run(process.execPath, [prismaCli, "migrate", "deploy"], "prisma migrate deploy");
    console.log("[migrate] migrations up to date");
  }

  const worker = spawn(process.execPath, [workerEntry], {
    stdio: "inherit",
    env: process.env,
  });
  forwardTo(worker);
  worker.on("error", (error) => {
    console.error("[worker] failed to start:", error);
    process.exit(1);
  });
  worker.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });
}

main().catch((error) => {
  console.error("[migrate]", error instanceof Error ? error.message : error);
  process.exit(1);
});
