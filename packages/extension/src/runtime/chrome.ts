import { isTaskActive, type TaskRuntime } from './index';

export const TASK_RUNTIME_ALARM = 'local-task-runtime-v1';
// Compatible with Chrome 120+. Alarms may be late, and do not wake a sleeping device.
const ALARM_PERIOD_MINUTES = 0.5;

async function ensureAlarm() {
  await chrome.alarms.create(TASK_RUNTIME_ALARM, { periodInMinutes: ALARM_PERIOD_MINUTES });
}

/** Call on each worker evaluation, after registering all definitions. */
export async function startRuntime(runtime: TaskRuntime): Promise<void> {
  if (!(await runtime.list()).some((job) => isTaskActive(job) || job.settled === false)) return;
  await ensureAlarm();
  await runtime.runner();
  // Keep the periodic wakeup: clearing it races with concurrent task submissions.
  // With no pending jobs its listener performs only a local read.
}

/** Install synchronously at module evaluation; no long-lived port or keepalive. */
export function wireTaskRuntime(runtime: TaskRuntime): () => void {
  runtime.setWake(ensureAlarm);
  const start = () => {
    void startRuntime(runtime).catch(() => {
      /* A durable pending job retries at the next alarm. */
    });
  };
  const alarm = (event: chrome.alarms.Alarm) => {
    if (event.name === TASK_RUNTIME_ALARM) start();
  };
  chrome.alarms.onAlarm.addListener(alarm);
  chrome.runtime.onStartup.addListener(start);
  chrome.runtime.onInstalled.addListener(start);
  return () => {
    chrome.alarms.onAlarm.removeListener(alarm);
    chrome.runtime.onStartup.removeListener(start);
    chrome.runtime.onInstalled.removeListener(start);
  };
}
