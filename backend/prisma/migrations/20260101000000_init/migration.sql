-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'COMMITTEE', 'ADMIN');

-- CreateEnum
CREATE TYPE "Phase" AS ENUM ('NOT_STARTED', 'PHASE_1', 'PHASE_2', 'PHASE_3', 'CLOSED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "departmentId" TEXT,
    "deviceHash" TEXT,
    "deviceRegisteredAt" TIMESTAMP(3),
    "deviceResetCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" TEXT NOT NULL,
    "forTeams" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nomination" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "nominatorId" TEXT NOT NULL,
    "nomineeId" TEXT,
    "nomineeDeptId" TEXT,
    "justification" TEXT NOT NULL,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "employeeId" TEXT,
    "departmentId" TEXT,
    "nominationPoints" INTEGER NOT NULL DEFAULT 0,
    "committeePoints" INTEGER NOT NULL DEFAULT 0,
    "finalPoints" INTEGER NOT NULL DEFAULT 0,
    "inPhase2" BOOLEAN NOT NULL DEFAULT false,
    "inPhase3" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitteeVote" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommitteeVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conflict" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "voterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteReceipt" (
    "id" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "phase" "Phase" NOT NULL DEFAULT 'NOT_STARTED',
    "resultsPublic" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");
CREATE UNIQUE INDEX "Employee_phone_key" ON "Employee"("phone");
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");
CREATE UNIQUE INDEX "Nomination_categoryId_nominatorId_key" ON "Nomination"("categoryId", "nominatorId");
CREATE INDEX "Nomination_nominatorId_isSelf_idx" ON "Nomination"("nominatorId", "isSelf");
CREATE INDEX "Nomination_categoryId_nomineeId_idx" ON "Nomination"("categoryId", "nomineeId");
CREATE INDEX "Nomination_categoryId_nomineeDeptId_idx" ON "Nomination"("categoryId", "nomineeDeptId");
CREATE UNIQUE INDEX "Candidate_categoryId_employeeId_key" ON "Candidate"("categoryId", "employeeId");
CREATE UNIQUE INDEX "Candidate_categoryId_departmentId_key" ON "Candidate"("categoryId", "departmentId");
CREATE INDEX "Candidate_categoryId_inPhase2_idx" ON "Candidate"("categoryId", "inPhase2");
CREATE INDEX "Candidate_categoryId_inPhase3_idx" ON "Candidate"("categoryId", "inPhase3");
CREATE UNIQUE INDEX "CommitteeVote_candidateId_memberId_key" ON "CommitteeVote"("candidateId", "memberId");
CREATE INDEX "CommitteeVote_categoryId_memberId_idx" ON "CommitteeVote"("categoryId", "memberId");
CREATE UNIQUE INDEX "Conflict_candidateId_memberId_key" ON "Conflict"("candidateId", "memberId");
CREATE INDEX "Vote_categoryId_idx" ON "Vote"("categoryId");
CREATE INDEX "Vote_candidateId_idx" ON "Vote"("candidateId");
CREATE UNIQUE INDEX "VoteReceipt_voterId_categoryId_key" ON "VoteReceipt"("voterId", "categoryId");
CREATE INDEX "VoteReceipt_categoryId_idx" ON "VoteReceipt"("categoryId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_nominatorId_fkey" FOREIGN KEY ("nominatorId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_nomineeId_fkey" FOREIGN KEY ("nomineeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Nomination" ADD CONSTRAINT "Nomination_nomineeDeptId_fkey" FOREIGN KEY ("nomineeDeptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitteeVote" ADD CONSTRAINT "CommitteeVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommitteeVote" ADD CONSTRAINT "CommitteeVote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conflict" ADD CONSTRAINT "Conflict_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conflict" ADD CONSTRAINT "Conflict_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoteReceipt" ADD CONSTRAINT "VoteReceipt_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
