/**
 * set_reminder — the call IS the structured output (contract): the app persists
 * the reminder locally and schedules a Notification if the deadline is near.
 */
import type { AparteTool, AparteToolHandler } from '@aparte/core';

const STORE_KEY = 'bp.reminders';
const MAX_TIMEOUT_MS = 24 * 3600 * 1000;

export interface StoredReminder {
  id: string;
  when: string;
  message: string;
  createdAt: number;
}

export const setReminderTool: AparteTool = {
  name: 'set_reminder',
  description: 'Programme un rappel local daté.',
  inputSchema: {
    type: 'object',
    required: ['when', 'message'],
    properties: { when: { type: 'string' }, message: { type: 'string' } },
  },
};

function readReminders(): StoredReminder[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as StoredReminder[];
  } catch {
    return [];
  }
}

export function listReminders(): StoredReminder[] {
  return readReminders();
}

export const setReminderHandler: AparteToolHandler = async (call) => {
  const when = String(call.input['when'] ?? '');
  const message = String(call.input['message'] ?? '');
  const date = new Date(when);

  if (Number.isNaN(date.getTime())) {
    return {
      toolCallId: call.id,
      content: JSON.stringify(
        { ok: false, type: 'set_reminder', error: `date invalide: ${when} (attendu ISO 8601)` },
        null,
        2,
      ),
    };
  }

  const reminder: StoredReminder = {
    id: `rem_${Date.now().toString(36)}`,
    when: date.toISOString(),
    message,
    createdAt: Date.now(),
  };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...readReminders(), reminder]));
  } catch {
    /* storage unavailable: session-only reminder */
  }

  // Local notification if the deadline falls while the app is open.
  const delay = date.getTime() - Date.now();
  if (delay > 0 && delay < MAX_TIMEOUT_MS && 'Notification' in window) {
    void Notification.requestPermission().then((perm) => {
      if (perm !== 'granted') return;
      setTimeout(() => new Notification("( '.' ) aparté — rappel", { body: message }), delay);
    });
  }

  return {
    toolCallId: call.id,
    content: JSON.stringify(
      { ok: true, type: 'set_reminder', when: reminder.when, message },
      null,
      2,
    ),
  };
};
