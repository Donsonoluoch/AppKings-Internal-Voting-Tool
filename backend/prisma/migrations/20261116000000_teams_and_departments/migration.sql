-- Split teams from departments: Team of the Year nominees are teams, not departments.
-- Existing team nominees (departments used as teams) are carried over to the new Team table
-- so no nomination or candidate rows are lost.

CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- Carry over every department that was actually used as a team nominee.
INSERT INTO "Team" ("id", "name")
SELECT DISTINCT d."id", d."name"
FROM "Department" d
WHERE d."id" IN (SELECT "nomineeDeptId" FROM "Nomination" WHERE "nomineeDeptId" IS NOT NULL)
   OR d."id" IN (SELECT "departmentId" FROM "Candidate" WHERE "departmentId" IS NOT NULL);

ALTER TABLE "Nomination" ADD COLUMN "nomineeTeamId" TEXT;
ALTER TABLE "Candidate" ADD COLUMN "teamId" TEXT;
ALTER TABLE "Employee" ADD COLUMN "teamId" TEXT;

UPDATE "Nomination" SET "nomineeTeamId" = "nomineeDeptId";
UPDATE "Candidate" SET "teamId" = "departmentId";

DROP INDEX IF EXISTS "Nomination_categoryId_nomineeDeptId_idx";
DROP INDEX IF EXISTS "Candidate_categoryId_departmentId_key";

ALTER TABLE "Nomination" DROP CONSTRAINT IF EXISTS "Nomination_nomineeDeptId_fkey";
ALTER TABLE "Candidate" DROP CONSTRAINT IF EXISTS "Candidate_departmentId_fkey";

ALTER TABLE "Nomination" DROP COLUMN "nomineeDeptId";
ALTER TABLE "Candidate" DROP COLUMN "departmentId";

CREATE INDEX "Nomination_categoryId_nomineeTeamId_idx" ON "Nomination"("categoryId", "nomineeTeamId");
CREATE UNIQUE INDEX "Candidate_categoryId_teamId_key" ON "Candidate"("categoryId", "teamId");
CREATE INDEX "Employee_teamId_idx" ON "Employee"("teamId");

ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_nomineeTeamId_fkey"
  FOREIGN KEY ("nomineeTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
