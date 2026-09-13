import { YAMLStore } from './BaseStore';
import { DEFAULT_QUEUE_SETTINGS, QueueSettings } from '../types';

export class QueueSettingsStore extends YAMLStore<QueueSettings> {
  constructor(workspaceRoot?: string) {
    super('settings', 'queue.yml', 'queue', workspaceRoot);
  }

  getSettings(): QueueSettings {
    const existing = this.getById('default');
    return existing
      ? { ...DEFAULT_QUEUE_SETTINGS, ...existing }
      : { ...DEFAULT_QUEUE_SETTINGS };
  }

  saveSettings(settings: Partial<QueueSettings>): QueueSettings {
    const current = this.getSettings();
    const merged: QueueSettings = { ...current, ...settings };
    if (this.getById('default')) {
      this.update('default', merged);
    } else {
      this.add(merged);
    }
    return merged;
  }
}