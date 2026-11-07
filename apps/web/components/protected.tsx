import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { identity } from "../lib/auth";
export async function Protected({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const user = await identity(
    new Request("http://internal", { headers: { cookie: jar.toString() } }),
  );
  if (!user) redirect("/");
  return children;
}
