CREATE TABLE "KnowledgeWorkspace" ("ownerId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE, "data" JSONB NOT NULL);
CREATE TABLE "KnowledgeSearchIndex" (
 "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "chunkId" TEXT NOT NULL,"documentId" TEXT NOT NULL,"summary" TEXT NOT NULL,"metadata" JSONB NOT NULL,"vector" JSONB,
 "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english',"summary")) STORED,
 PRIMARY KEY ("ownerId","chunkId")
);
CREATE INDEX "KnowledgeSearchIndex_fts" ON "KnowledgeSearchIndex" USING GIN ("searchVector");
CREATE TABLE "TaskJob" (
 "id" TEXT PRIMARY KEY,"ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "shootId" TEXT REFERENCES "Shoot"("id") ON DELETE CASCADE,"kind" TEXT NOT NULL,"idempotencyKey" TEXT NOT NULL,"status" TEXT NOT NULL,"data" JSONB NOT NULL,
 UNIQUE ("ownerId","kind","idempotencyKey")
);
CREATE INDEX "TaskJob_status" ON "TaskJob"("status");
