import pg from "pg";
import { readFile } from "node:fs/promises";

// Uses only a runtime binding. Never accepts a URL in command-line arguments or logs it.
async function main() {
  const connection = process.env.DATABASE_URL;
  if (!connection) {
    console.error(
      "DATABASE_URL is not bound. Configure it securely in runtime environment settings.",
    );
    process.exitCode = 1;
    return;
  }
  const url = new URL(connection);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("INVALID_DATABASE_PROTOCOL");
  const ca = process.env.DB_SSL_CA_FILE
    ? await readFile(process.env.DB_SSL_CA_FILE, "utf8")
    : undefined;
  const client = new pg.Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: {
      rejectUnauthorized: true,
      servername: url.hostname,
      ...(ca ? { ca } : {}),
    },
    connectionTimeoutMillis: 8000,
    query_timeout: 5000,
    application_name: "framecraft-connectivity-check",
    options: "-c default_transaction_read_only=on",
  });
  try {
    await client.connect();
    const result = await client.query<{
      database: string;
      read_only: string;
      server_version: string;
    }>(
      "SELECT current_database() AS database, current_setting('transaction_read_only') AS read_only, current_setting('server_version') AS server_version",
    );
    if (result.rows[0]?.read_only !== "on")
      throw new Error("READ_ONLY_NOT_ENABLED");
    console.log(
      JSON.stringify({
        status: "connected",
        tls: "certificate and hostname verified",
        ...result.rows[0],
      }),
    );
  } finally {
    await client.end();
  }
}
main().catch((error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : error instanceof Error &&
          ["INVALID_DATABASE_PROTOCOL", "READ_ONLY_NOT_ENABLED"].includes(
            error.message,
          )
        ? error.message
        : "CONNECTION_FAILED";
  // Driver error text can contain connection details; report only stable codes.
  console.error(
    JSON.stringify({
      status: "not_connected",
      code,
      instructions:
        "Check the runtime DATABASE_URL binding, PostgreSQL TCP reachability, verified TLS trust and database access policy. No migrations were run.",
    }),
  );
  process.exitCode = 1;
});
