-- HU-VEN-14: a cashier requests the cancellation of a sale. A request can also be withdrawn by its requester, and it keeps
-- what the requester wrote apart from the decider's reply (`comment`).

-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "requester_comment" TEXT;

-- One PENDING request per subject and type: two cashiers asking at once cannot both succeed. Prisma cannot express a
-- partial index, so it lives only here.
CREATE UNIQUE INDEX "approval_requests_one_pending_uq" ON "approval_requests"("company_id", "type", "subject_id") WHERE "status" = 'PENDING';
