-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAdmin" BOOLEAN NOT NULL
);

-- CreateTable
CREATE TABLE "UserGithub" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "githubId" INTEGER NOT NULL,
    "githubUsername" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "avatarUrl" TEXT,
    CONSTRAINT "UserGithub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "template" TEXT NOT NULL DEFAULT 'blank',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectPackageSet" (
    "projectId" TEXT NOT NULL,
    "packageSet" TEXT NOT NULL,

    PRIMARY KEY ("projectId", "packageSet"),
    CONSTRAINT "ProjectPackageSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AllowedGithubUser" (
    "githubUsername" TEXT NOT NULL PRIMARY KEY
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UserGithub_githubId_key" ON "UserGithub"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_userId_name_key" ON "Project"("userId", "name");

