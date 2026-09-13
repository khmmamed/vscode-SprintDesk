import { YAMLStore } from './BaseStore';
import { DEFAULT_APPROVAL_GATES, DEFAULT_QUEUE_SETTINGS, QueueSettings } from '../types';

export class QueueSettingsStore extends YAMLStore<QueueSettings> {
  constructor(workspaceRoot?: string) {
    super('settings', 'queue.yml', 'queue', workspaceRoot);
  }

  getSettings(): QueueSettings {
    const existing = this.getById('default');
    if (!existing) return { ...DEFAULT_QUEUE_SETTINGS };
    return {
      ...DEFAULT_QUEUE_SETTINGS,
      ...existing,
      approvalGates: { ...DEFAULT_APPROVAL_GATES, ...(existing.approvalGates || {}) }
    };
  }

  saveSettings(settings: Partial<QueueSettings>): QueueSettings {
    const current = this.getSettings();
    const gates = settings.approvalGates
      ? { ...DEFAULT_APPROVAL_GATES, ...current.approvalGates, ...settings.approvalGates }
      : undefined;
    const merged: QueueSettings = {
      ...current,
      ...settings,
      ...(gates ? { approvalGates: gates } : {})
    };
    if (this.getById('default')) {
      this.update('default', merged);
    } else {
      this.add(merged);
    }
    return merged;
  }
}