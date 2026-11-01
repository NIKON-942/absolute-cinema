import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { UploadManager } from '@/services/uploadManager';

const UploadContext = createContext<UploadManager | null>(null);
export function UploadProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => new UploadManager());
  const { user, isAdmin } = useAuth();
  useEffect(() => {
    const controller = new AbortController();
    // Retry restoring the server's durable sessions after a transient outage.
    const restore = async () => {
      while (!controller.signal.aborted) {
        try { await manager.connect(isAdmin && user ? user.id : null, controller.signal); return; }
        catch { await new Promise(resolve => setTimeout(resolve, 3000)); }
      }
    };
    void restore();
    return () => controller.abort();
  }, [manager, user?.id, isAdmin]);
  useEffect(() => {
    const timer = setInterval(() => { void manager.poll(); }, 2000);
    const preventExit = (event: BeforeUnloadEvent) => {
      if (manager.snapshot().some(task => ['hashing', 'uploading', 'retrying'].includes(task.phase))) event.preventDefault();
    };
    window.addEventListener('beforeunload', preventExit);
    return () => { clearInterval(timer); window.removeEventListener('beforeunload', preventExit); };
  }, [manager]);
  return <UploadContext.Provider value={manager}>{children}</UploadContext.Provider>;
}
export function useUploads() {
  const manager = useContext(UploadContext);
  if (!manager) throw new Error('useUploads requires UploadProvider');
  const tasks = useSyncExternalStore(manager.subscribe, manager.snapshot);
  return { manager, tasks };
}
