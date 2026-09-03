-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "template" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_project" ("createdAt", "id", "isPublic", "name", "template", "updatedAt", "userId") SELECT "createdAt", "id", "isPublic", "name", "template", "updatedAt", "userId" FROM "project";
DROP TABLE "project";
ALTER TABLE "new_project" RENAME TO "project";
CREATE UNIQUE INDEX "project_userId_name_key" ON "project"("userId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
