async function main() {
  // Explicit target only; never invent a deployment or submit user data.
  const target = process.env.SMOKE_BASE_URL;
  if (!target || !/^https:\/\//.test(target))
    throw new Error("Set SMOKE_BASE_URL to the actual HTTPS deployment.");
  for (const pathname of ["/api/v1/health", "/api/v1/ready", "/"]) {
    const r = await fetch(new URL(pathname, target), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Smoke failed ${pathname}: HTTP ${r.status}`);
    if (pathname === "/api/v1/ready") {
      const json = await r.json();
      if (json.data?.mode === "local-mock")
        throw new Error("Deployment is using local mock persistence");
    }
    console.log(`PASS ${pathname}: HTTP ${r.status}`);
  }
  const denied = await fetch(new URL("/api/v1/shoots", target), {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (denied.status !== 401)
    throw new Error("Unauthenticated API protection failed");
  console.log("PASS protected API: HTTP 401");
}
main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "Smoke test failed");
  process.exitCode = 1;
});
export {};
