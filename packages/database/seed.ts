import { database } from "../../apps/web/lib/store";
import { hashPassword } from "../../apps/web/lib/auth";
import { defaults } from "../shared/src/shoot";
async function main() {
  const email = process.env.SEED_EMAIL?.toLowerCase();
  const password = process.env.SEED_PASSWORD;
  if (!email || !password) {
    console.log(
      "No seed credentials supplied; schema verified without creating accounts.",
    );
    await database().$queryRaw`SELECT 1`;
    return;
  }
  if (password.length < 12)
    throw new Error("Seed password must be at least 12 characters");
  const user = await database().user.upsert({
    where: { email },
    create: { email, passwordHash: hashPassword(password) },
    update: {},
  });
  const existing = await database().shoot.findFirst({
    where: { ownerId: user.id, name: "Golden Hour Family Portrait" },
  });
  if (!existing)
    await database().shoot.create({
      data: {
        ownerId: user.id,
        name: "Golden Hour Family Portrait",
        data: {
          ...defaults,
          name: "Golden Hour Family Portrait",
          portraitCategory: "PORTRAIT_GROUP",
          subjectCategory: "FAMILY_MIXED",
          subjectCount: 4,
        },
      },
    });
  console.log("Seed complete");
}
main().finally(() => database().$disconnect());
