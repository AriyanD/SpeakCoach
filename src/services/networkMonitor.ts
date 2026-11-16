import { Network } from '@capacitor/network';

export type NetworkStatusListener = (online: boolean) => void;

class NetworkMonitorService {
  private online = true;
  private initialized = false;
  private listeners = new Set<NetworkStatusListener>();

  constructor() {
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      this.online = navigator.onLine;
    }
  }

  public async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const status = await Network.getStatus();
      await Network.addListener('networkStatusChange', (s) => {
        this.setOnline(s.connected);
      });
      this.setOnline(status.connected);
    } catch {
      // Fallback to browser window online/offline events
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => this.setOnline(true));
        window.addEventListener('offline', () => this.setOnline(false));
      }
    }
  }

  public isOnline(): boolean {
    return this.online;
  }

  public setOnline(online: boolean): void {
    const changed = this.online !== online;
    this.online = online;
    if (changed) {
      for (const listener of this.listeners) {
        listener(this.online);
      }
    }
  }

  public subscribe(listener: NetworkStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const networkMonitor = new NetworkMonitorService();
