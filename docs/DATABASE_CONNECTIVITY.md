# Database connectivity

`pnpm db:check` reads DATABASE_URL only from a runtime environment binding. It verifies PostgreSQL TLS certificate/hostname and executes one SELECT with default_transaction_read_only=on. It logs no URL, password or raw driver error text. It never generates a client, runs migrations, seeds accounts or modifies the remote schema. URL sslmode query parameters cannot disable its certificate verification. A private CA may be supplied through DB_SSL_CA_FILE.

The supplied external Render endpoint has not been connected. Observed in this managed environment: no DATABASE_URL binding; executor hostname resolution failed; an approved credential-free CONNECT probe to proxy:8088 returned connection refused; VPN is unconfigured and TCP grants are empty. No authentication exchange or SQL statement reached Render. These results do not establish whether the external password, database or Render access rules are valid.

The checker was separately verified against a local PostgreSQL 16 server with a temporary trusted certificate, hostname verification and read-only SQL. That proves the local checker workflow, not remote connectivity. The negative test rejected an untrusted certificate; the positive test accepted the configured trusted certificate. Local test-only SSL settings were restored afterward.

Next steps:

1. Store DATABASE_URL securely in the actual app/task runtime, without putting it in source, command arguments, logs or chat. A name-only environment requirement has been saved in the draft; no credential value was copied into configuration. PostgreSQL requires a real application runtime binding rather than an HTTP-proxy credential placeholder.
2. Run from a machine or Render service that supports outbound PostgreSQL TCP, or configure a supported network path for this cloud environment. Its HTTP allowlist alone does not grant PostgreSQL/TCP access. Check Render external access rules for the intended client's egress IP once a real route exists.
3. Run `pnpm db:check`; a successful result must report certificate/hostname verification and read_only=on.
4. Only after that, separately review migration/seed operations. The connectivity request does not itself authorize applying migrations to a potentially existing user database.

Prisma engine download access (`binaries.prisma.sh`) remains a separate prerequisite for Prisma generation and migration verification. PostgreSQL stores application records; private photo blobs still need a configured object-store adapter and bucket. Neither a database URL nor SQL connectivity supplies S3 storage.

Review/save the requirement in environment settings; publish the environment only after network and credential setup is validated. No settings have been published by the agent.
