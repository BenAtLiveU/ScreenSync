import { useEffect, useRef, useState, useCallback } from 'react';

type SyncMessage = 
  | { type: 'INIT'; fileName: string; mediaId?: string; isImage?: boolean; duration?: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; time: number }
  | { type: 'SYNC_REQUEST' }
  | { type: 'PING'; timestamp: number }
  | { type: 'PONG'; timestamp: number }
  | { type: 'PLAYLIST_UPDATE'; items: any[] };

export function useBroadcastChannel(onMessage?: (msg: SyncMessage) => void) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    // 1. BroadcastChannel (Modern)
    const channel = new BroadcastChannel('sync-split-channel');
    channelRef.current = channel;

    const handleBCMessage = (event: MessageEvent<SyncMessage>) => {
      onMessageRef.current?.(event.data);
    };

    channel.addEventListener('message', handleBCMessage);

    // 2. LocalStorage (Legacy/Iframe Fallback)
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'sync-split-msg' && event.newValue) {
        try {
          const msg = JSON.parse(event.newValue);
          onMessageRef.current?.(msg);
        } catch (e) {
          console.error('Failed to parse storage message', e);
        }
      }
    };

    window.addEventListener('storage', handleStorage);

    return () => {
      channel.removeEventListener('message', handleBCMessage);
      channel.close();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const postMessage = useCallback((msg: SyncMessage) => {
    // Send via BroadcastChannel
    try {
      channelRef.current?.postMessage(msg);
    } catch (e) {}

    // Send via LocalStorage (triggers 'storage' event in other windows)
    try {
      localStorage.setItem('sync-split-msg', JSON.stringify({
        ...msg,
        _id: Math.random().toString(36).substring(7),
        _ts: Date.now()
      }));
    } catch (e) {}
  }, []);

  return { postMessage };
}
