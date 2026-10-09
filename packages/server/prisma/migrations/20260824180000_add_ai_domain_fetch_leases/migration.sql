CREATE TABLE "AiFetchDomainLease" (
    "domainHash" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "nextRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiFetchDomainLease_pkey" PRIMARY KEY ("domainHash", "slot")
);

CREATE INDEX "AiFetchDomainLease_updatedAt_idx" ON "AiFetchDomainLease"("updatedAt");
