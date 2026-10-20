import type { AiSettings, AiSettingsStore } from './ai-settings-service';
import { prisma, userPrisma } from './userPrisma';

export class PrismaAiSettingsStore implements AiSettingsStore {
  resolveInternalUserId(userId: string) {
    return userPrisma.resolveInternalUserId(userId);
  }
  async get(userId: string): Promise<AiSettings | undefined> {
    const value = await prisma.aiSettings.findUnique({ where: { userId } });
    return value ? fromRecord(value) : undefined;
  }
  async save(userId: string, settings: AiSettings): Promise<AiSettings> {
    const value = await prisma.aiSettings.upsert({
      where: { userId },
      create: toRecord(userId, settings),
      update: toRecord(userId, settings),
    });
    return fromRecord(value);
  }
}

function toRecord(userId: string, settings: AiSettings) {
  return {
    userId,
    singlePageEnabled: settings.singlePageEnabled,
    batchEnabled: settings.batchEnabled,
    descriptionPropertyId: settings.properties?.descriptionPropertyId || null,
    tagsPropertyId: settings.properties?.tagsPropertyId || null,
  };
}

function fromRecord(value: {
  singlePageEnabled: boolean;
  batchEnabled: boolean;
  descriptionPropertyId: string | null;
  tagsPropertyId: string | null;
}): AiSettings {
  const properties =
    value.descriptionPropertyId && value.tagsPropertyId
      ? { descriptionPropertyId: value.descriptionPropertyId, tagsPropertyId: value.tagsPropertyId }
      : undefined;
  return {
    singlePageEnabled: value.singlePageEnabled,
    batchEnabled: value.batchEnabled,
    properties,
  };
}
