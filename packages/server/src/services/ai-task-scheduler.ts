const AI_MAX_CONCURRENT_PROVIDER_CALLS_PER_USER = 2;

export interface SchedulableAiTask {
  id: string;
  userId: string;
  createdAt: Date;
}

/**
 * Selects work in user-round-robin order. The caller performs the lease claim,
 * so a concurrent worker can safely discard a task that was claimed elsewhere.
 */
export function selectFairAiTasks<T extends SchedulableAiTask>(
  queued: readonly T[],
  activeByUser: ReadonlyMap<string, number>,
  maxTasks: number
): T[] {
  const byUser = new Map<string, T[]>();
  for (const task of [...queued].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if ((activeByUser.get(task.userId) || 0) >= AI_MAX_CONCURRENT_PROVIDER_CALLS_PER_USER) continue;
    const tasks = byUser.get(task.userId) || [];
    tasks.push(task); byUser.set(task.userId, tasks);
  }
  const result: T[] = [];
  while (result.length < maxTasks) {
    let selected = false;
    for (const [userId, tasks] of byUser) {
      const active = (activeByUser.get(userId) || 0) + result.filter((task) => task.userId === userId).length;
      if (active >= AI_MAX_CONCURRENT_PROVIDER_CALLS_PER_USER || !tasks.length || result.length >= maxTasks) continue;
      result.push(tasks.shift()!); selected = true;
    }
    if (!selected) break;
  }
  return result;
}
