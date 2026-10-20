import { prisma, userPrisma } from './userPrisma';
import type { AiCredentialStore, StoredAiProviderCredential } from './ai-credential-service';

const credentialSelect = {
  userId: true,
  provider: true,
  encryptionScheme: true,
  encryptionKeyVersion: true,
  initializationVector: true,
  authenticationTag: true,
  encryptedSecret: true,
  keyLastFour: true,
  credentialVersion: true,
  status: true,
  verifiedAt: true,
} as const;

export class PrismaAiCredentialStore implements AiCredentialStore {
  resolveInternalUserId(userId: string): Promise<string | undefined> {
    return userPrisma.resolveInternalUserId(userId);
  }

  async findCredential(userId: string): Promise<StoredAiProviderCredential | undefined> {
    const credential = await prisma.aiProviderCredential.findUnique({
      where: { userId },
      select: credentialSelect,
    });
    return credential ? fromPrismaCredential(credential) : undefined;
  }

  async saveCredential(credential: StoredAiProviderCredential): Promise<void> {
    await prisma.aiProviderCredential.upsert({
      where: { userId: credential.userId },
      create: toPrismaCredential(credential),
      update: toPrismaCredential(credential),
    });
  }

  async deleteCredential(userId: string): Promise<void> {
    await prisma.aiProviderCredential.deleteMany({ where: { userId } });
  }

  async stopTasksForDeletedCredential(userId: string): Promise<void> {
    await prisma.aiGenerationTask.updateMany({
      where: {
        userId,
        status: { in: ['awaiting_confirmation', 'queued', 'processing', 'paused'] },
      },
      data: {
        status: 'needs_action',
        reasonCode: 'needs_action_credential_deleted',
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
      },
    });
  }

  async reconcileTasksWithActiveCredential(
    userId: string,
    credential: Pick<StoredAiProviderCredential, 'provider' | 'credentialVersion'> & {
      model: string;
    }
  ): Promise<void> {
    const taskData = {
      provider: credential.provider,
      model: credential.model,
      credentialVersion: credential.credentialVersion,
    };
    const staleCredential = {
      OR: [
        { provider: { not: credential.provider } },
        { model: { not: credential.model } },
        { credentialVersion: { not: credential.credentialVersion } },
      ],
    };
    await prisma.$transaction([
      // Keep a confirmation-gated batch gated, while making it use the verified key.
      prisma.aiGenerationTask.updateMany({
        where: { userId, status: 'awaiting_confirmation', ...staleCredential },
        data: taskData,
      }),
      // Resume only work made actionable by credential rotation. Other needs-action
      // states (for example a Notion schema problem) require their own resolution.
      prisma.aiGenerationTask.updateMany({
        where: {
          userId,
          OR: [
            { status: 'queued', ...staleCredential },
            { status: 'processing', ...staleCredential },
            {
              status: 'needs_action',
              reasonCode: {
                in: [
                  'needs_action_credential_deleted',
                  'needs_action_invalid_api_key',
                  'needs_action_insufficient_quota',
                  'needs_action_model_access',
                ],
              },
            },
          ],
        },
        data: {
          ...taskData,
          status: 'queued',
          reasonCode: null,
          completedAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
        },
      }),
    ]);
  }
}

function toPrismaCredential(credential: StoredAiProviderCredential) {
  return {
    userId: credential.userId,
    provider: credential.provider,
    encryptionScheme: credential.scheme,
    encryptionKeyVersion: credential.keyVersion,
    initializationVector: credential.initializationVector,
    authenticationTag: credential.authenticationTag,
    encryptedSecret: credential.ciphertext,
    keyLastFour: credential.keyLastFour,
    credentialVersion: credential.credentialVersion,
    status: credential.status,
    verifiedAt: credential.verifiedAt,
  };
}

function fromPrismaCredential(
  credential: typeof credentialSelect extends never
    ? never
    : {
        userId: string;
        provider: string;
        encryptionScheme: string;
        encryptionKeyVersion: number;
        initializationVector: string;
        authenticationTag: string;
        encryptedSecret: string;
        keyLastFour: string;
        credentialVersion: number;
        status: string;
        verifiedAt: Date | null;
      }
): StoredAiProviderCredential {
  return {
    userId: credential.userId,
    provider: credential.provider,
    scheme: credential.encryptionScheme as 'aes-256-gcm',
    keyVersion: credential.encryptionKeyVersion,
    initializationVector: credential.initializationVector,
    authenticationTag: credential.authenticationTag,
    ciphertext: credential.encryptedSecret,
    keyLastFour: credential.keyLastFour,
    credentialVersion: credential.credentialVersion,
    status: credential.status,
    verifiedAt: credential.verifiedAt,
  };
}
