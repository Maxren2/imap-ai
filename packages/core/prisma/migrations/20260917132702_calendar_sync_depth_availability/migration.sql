-- AlterTable
ALTER TABLE "EmailAccount" ADD COLUMN     "syncDepthDays" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availabilityDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "availabilityEnd" TEXT,
ADD COLUMN     "availabilityStart" TEXT,
ADD COLUMN     "availabilityTimezone" TEXT;

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "oauthRefreshTokenEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_provider_email_key" ON "CalendarConnection"("userId", "provider", "email");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
