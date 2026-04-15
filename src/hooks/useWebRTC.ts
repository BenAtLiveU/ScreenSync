import { useEffect, useRef, useCallback } from 'react';

export function useWebRTC(role: 'controller' | 'player', onStream?: (stream: MediaStream) => void) {
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const signalingChannel = useRef<BroadcastChannel | null>(null);

  const createPC = useCallback((id: string, stream?: MediaStream) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const iceMsg = {
          type: 'ICE',
          target: id,
          candidate: event.candidate,
          from: role === 'controller' ? 'controller' : id
        };
        const storageKey = `webrtc-signal-${window.location.pathname.replace(/\//g, '-')}`;
        signalingChannel.current?.postMessage(iceMsg);
        localStorage.setItem(storageKey, JSON.stringify({ ...iceMsg, _ts: Date.now() }));
      }
    };

    if (role === 'player') {
      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          onStream?.(event.streams[0]);
        }
      };
    }

    if (stream) {
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }

    pcs.current.set(id, pc);
    return pc;
  }, [role, onStream]);

  useEffect(() => {
    const channelName = `webrtc-signaling-${window.location.pathname.replace(/\//g, '-')}`;
    const storageKey = `webrtc-signal-${window.location.pathname.replace(/\//g, '-')}`;
    
    const bc = new BroadcastChannel(channelName);
    signalingChannel.current = bc;

    const handleSignaling = async (data: any) => {
      const { type, target, from, sdp, candidate } = data;

      // Controller logic
      if (role === 'controller') {
        if (type === 'JOIN') {
          createPC(from);
        } else if (type === 'ANSWER' && target === 'controller') {
          const pc = pcs.current.get(from);
          if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        } else if (type === 'ICE' && target === 'controller') {
          const pc = pcs.current.get(from);
          if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } 
      
      // Player logic
      else {
        const params = new URLSearchParams(window.location.search);
        const myId = window.name || `player-${params.get('part')}` || 'player-unknown';
        if (type === 'OFFER' && target === myId) {
          const pc = createPC('controller');
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          const response = { type: 'ANSWER', target: 'controller', from: myId, sdp: answer };
          bc.postMessage(response);
          localStorage.setItem(storageKey, JSON.stringify({ ...response, _ts: Date.now() }));
        } else if (type === 'ICE' && target === myId) {
          const pc = pcs.current.get('controller');
          if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    };

    bc.onmessage = (event) => handleSignaling(event.data);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey && event.newValue) {
        try {
          handleSignaling(JSON.parse(event.newValue));
        } catch (e) {}
      }
    };
    window.addEventListener('storage', handleStorage);

    if (role === 'player') {
      const params = new URLSearchParams(window.location.search);
      const myId = window.name || `player-${params.get('part')}` || 'player-unknown';
      const joinMsg = { type: 'JOIN', from: myId };
      bc.postMessage(joinMsg);
      localStorage.setItem(storageKey, JSON.stringify({ ...joinMsg, _ts: Date.now() }));
    }

    return () => {
      bc.close();
      window.removeEventListener('storage', handleStorage);
      pcs.current.forEach(pc => pc.close());
      pcs.current.clear();
    };
  }, [role, createPC]);

  const startStreaming = useCallback(async (stream: MediaStream) => {
    if (role !== 'controller') return;
    
    const storageKey = `webrtc-signal-${window.location.pathname.replace(/\//g, '-')}`;
    
    for (const [id, pc] of pcs.current.entries()) {
      if (pc.getSenders().length === 0) {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const offerMsg = {
          type: 'OFFER',
          target: id,
          from: 'controller',
          sdp: offer
        };
        signalingChannel.current?.postMessage(offerMsg);
        localStorage.setItem(storageKey, JSON.stringify({ ...offerMsg, _ts: Date.now() }));
      }
    }
  }, [role]);

  return { startStreaming };
}
