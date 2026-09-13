-- CreateTable
CREATE TABLE "RejectionNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "projectModuleId" TEXT,
    "reason" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    CONSTRAINT "RejectionNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RejectionNote_projectModuleId_fkey" FOREIGN KEY ("projectModuleId") REFERENCES "ProjectModule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
