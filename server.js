import { createApp } from "./server/app.js";

const { server, config, close } = await createApp();

server.listen(config.port, config.host, () => {
  console.log(`AFG AI ${config.version} listening on http://${config.host}:${config.port}`);
  console.log(`Data directory: ${config.dataDir}`);
  if (config.auth.ephemeralSecret) {
    console.warn(
      "AUTH_SECRET is not set. Sessions will be signed with an ephemeral key and reset on restart. Set AUTH_SECRET in production."
    );
  }
  if (!config.env.startsWith("prod")) {
    console.log("Tip: run `npm test` to verify routing, auth and storage.");
  }
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down…`);
  try {
    await close();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
