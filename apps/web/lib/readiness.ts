import { database, mockMode } from "./store";
export async function readiness() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (mockMode())
      return Response.json(
        {
          data: { status: "ready", mode: "local-mock" },
          error: null,
          meta: {},
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    await Promise.race([
      database().$queryRaw`SELECT 1`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 3000);
      }),
    ]);
    return Response.json(
      {
        data: { status: "ready", checks: ["postgresql"] },
        error: null,
        meta: {},
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        data: null,
        error: {
          code: "NOT_READY",
          message: "Required database connection unavailable.",
        },
        meta: {},
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}
