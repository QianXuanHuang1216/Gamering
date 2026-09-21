export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getDb } = await import("./lib/db.js");
    const { startWorker } = await import("./lib/worker.js");
    startWorker(getDb());
  }
}
