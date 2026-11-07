CREATE TABLE "ShootWorkspace" (
 "shootId" TEXT NOT NULL PRIMARY KEY,
 "data" JSONB NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ShootWorkspace_shootId_fkey" FOREIGN KEY ("shootId") REFERENCES "Shoot"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CameraKit" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "ownerId" TEXT NOT NULL,
 "name" TEXT NOT NULL,
 "data" JSONB NOT NULL,
 CONSTRAINT "CameraKit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CameraKit_ownerId_idx" ON "CameraKit"("ownerId");
