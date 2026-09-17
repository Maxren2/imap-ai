-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredLlmModelId" TEXT;

-- CreateTable
CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiBaseUrl" TEXT,
    "apiKeyEnc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmModel" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "enabledForUsers" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceSettings" (
    "id" TEXT NOT NULL DEFAULT 'instance',
    "googleClientId" TEXT,
    "googleClientSecretEnc" TEXT,
    "microsoftClientId" TEXT,
    "microsoftClientSecretEnc" TEXT,
    "microsoftTenant" TEXT,
    "defaultLlmModelId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmModel_providerId_modelId_key" ON "LlmModel"("providerId", "modelId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_preferredLlmModelId_fkey" FOREIGN KEY ("preferredLlmModelId") REFERENCES "LlmModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmModel" ADD CONSTRAINT "LlmModel_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LlmProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceSettings" ADD CONSTRAINT "InstanceSettings_defaultLlmModelId_fkey" FOREIGN KEY ("defaultLlmModelId") REFERENCES "LlmModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
