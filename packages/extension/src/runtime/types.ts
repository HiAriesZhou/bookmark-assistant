export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale';

/** Local-only task data. Definitions must project inputs/state; never put credentials here. */
export interface TaskRecord<Input = unknown, State = unknown> {
  id: string;
  type: string;
  input: Input;
  state: State;
  revision: string;
  dedupeKey?: string;
  status: TaskStatus;
  attempts: number;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
  version: number;
  errorCode?: string;
  settled?: boolean;
  /** The user applied or discarded the terminal result; it is no longer restored. */
  dismissed?: boolean;
}

export interface TaskStore {
  get(id: string): Promise<TaskRecord | undefined>;
  list(): Promise<TaskRecord[]>;
  /** Atomic read/modify/write. Returning undefined leaves the record unchanged. */
  update(
    id: string,
    change: (current: TaskRecord | undefined) => TaskRecord | undefined
  ): Promise<TaskRecord | undefined>;
}

export interface TaskDefinition<Input, State> {
  initialize(input: Input): State;
  isCurrent?(job: TaskRecord<Input, State>): Promise<boolean>;
  step(
    job: TaskRecord<Input, State>,
    context: { signal: AbortSignal }
  ): Promise<{ state: State; done: boolean }>;
  /** Return only a public error code; arbitrary exception text is never stored. */
  retry?(error: unknown): { code: string; retryAfterMs?: number; retryable?: boolean } | null;
  /** Idempotent terminal-state work. A failed hook stays unsettled and retries later. */
  onSettled?(job: TaskRecord<Input, State>): Promise<void>;
}

export const isTaskActive = (job: TaskRecord) =>
  job.status === 'pending' || job.status === 'running';
