-- A Team can now be a department staff belong to (the legacy rows, which are retired) or one
-- of the seven business teams from packages/shared/constants.js used for Team of the Year.
-- nameKept is the retired legacy name, so the old roster assignment is not lost.

ALTER TABLE "Team" ADD COLUMN "code" TEXT;
ALTER TABLE "Team" ADD COLUMN "nameKept" TEXT;

CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");
