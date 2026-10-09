import { describe, expect, it } from 'vitest';
import { selectFairAiTasks } from './ai-task-scheduler';

const task = (id: string, userId: string, minute: number) => ({ id, userId, createdAt: new Date(`2026-08-23T00:${String(minute).padStart(2, '0')}:00Z`) });

describe('selectFairAiTasks', () => {
  it('round-robins users before taking a second task from one user', () => {
    expect(selectFairAiTasks([task('a1', 'a', 1), task('a2', 'a', 2), task('b1', 'b', 3), task('c1', 'c', 4)], new Map(), 4).map((item) => item.id)).toEqual(['a1', 'b1', 'c1', 'a2']);
  });
  it('does not schedule users already at their provider concurrency limit', () => {
    expect(selectFairAiTasks([task('a1', 'a', 1), task('b1', 'b', 2)], new Map([['a', 2]]), 2).map((item) => item.id)).toEqual(['b1']);
  });
});
