import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, RotateCcw, Monitor, Upload, Settings, ExternalLink, Info, Maximize, Plus, Trash2, GripVertical, Image as ImageIcon, Film, ChevronUp, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useBroadcastChannel } from './hooks/useBroadcastChannel';
import { saveMediaToDB, getMediaFromDB, saveLibrary, getLibrary, deleteMedia, MediaMetadata } from './lib/videoDb';
import { useWebRTC } from './hooks/useWebRTC';

type ViewMode = 'controller' | 'player';

export default function App() {
  const [view, setView] = useState<ViewMode>('controller');
  const [part, setPart] = useState<number>(0);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  
  // Sync settings
  const [zoom, setZoom] = useState(100);
  const [offsetX, setOffsetX] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [lastPing, setLastPing] = useState<number>(0);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  // Playlist state
  const [playlist, setPlaylist] = useState<MediaMetadata[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLooping, setIsLooping] = useState(true);
  const [isImage, setIsImage] = useState(false);
  const [imageDuration, setImageDuration] = useState(5); // seconds
  const [savedPlaylists, setSavedPlaylists] = useState<{ name: string, items: MediaMetadata[] }[]>([]);
  const [playlistName, setPlaylistName] = useState('New Playlist');
  const imageTimerRef = useRef<NodeJS.Timeout | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const postMessageRef = useRef<(msg: any) => void>(() => {});

  // Determine view from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('view');
    const p = params.get('part');
    if (v === 'player') {
      setView('player');
      setPart(parseInt(p || '0', 10));
      
      // Request sync from controller with retries
      let retries = 0;
      const requestSync = () => {
        if (retries < 5) {
          postMessageRef.current({ type: 'SYNC_REQUEST' });
          retries++;
          setTimeout(requestSync, 1000);
        }
      };
      setTimeout(requestSync, 500);
    }
  }, []);

  const { startStreaming } = useWebRTC(view, (stream) => {
    console.log('[SyncSplit] Received remote WebRTC stream');
    setRemoteStream(stream);
  });

  const loadMediaFromDB = useCallback(async (id?: string) => {
    const targetId = id || (playlist[currentIndex]?.id);
    if (!targetId) return false;

    console.log('[SyncSplit] Attempting to load media from IndexedDB:', targetId);
    const file = await getMediaFromDB(targetId);
    if (file) {
      console.log('[SyncSplit] Media found in DB:', file.name);
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setFileName(file.name);
      setVideoFile(file);
      setIsImage(file.type.startsWith('image/'));
      return true;
    }
    console.log('[SyncSplit] No media found in DB.');
    return false;
  }, [videoUrl, playlist, currentIndex]);

  const nextMedia = useCallback(() => {
    if (playlist.length === 0) return;
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (isLooping) {
        nextIndex = 0;
      } else {
        setIsPlaying(false);
        return;
      }
    }
    setCurrentIndex(nextIndex);
  }, [playlist, currentIndex, isLooping]);

  useEffect(() => {
    if (view === 'controller' && playlist[currentIndex]) {
      const item = playlist[currentIndex];
      const isImg = item.type.startsWith('image/');
      postMessageRef.current({ 
        type: 'INIT', 
        fileName: item.name, 
        mediaId: item.id,
        isImage: isImg,
        duration: item.duration
      });
      loadMediaFromDB(item.id);
    }
  }, [currentIndex, playlist, view]);

  const onVideoEnded = useCallback(() => {
    if (view === 'controller') {
      nextMedia();
    }
  }, [view, nextMedia]);

  useEffect(() => {
    if (isImage && isPlaying && view === 'controller') {
      const duration = playlist[currentIndex]?.duration || 5;
      imageTimerRef.current = setTimeout(() => {
        nextMedia();
      }, duration * 1000);
    }
    return () => {
      if (imageTimerRef.current) clearTimeout(imageTimerRef.current);
    };
  }, [isImage, isPlaying, currentIndex, playlist, view, nextMedia]);

  const handleMessage = useCallback((msg: any) => {
    console.log(`[SyncSplit] Received message on ${view}:`, msg.type);
    
    if (msg.type === 'PING') {
      postMessageRef.current({ type: 'PONG', timestamp: msg.timestamp });
      return;
    }
    
    if (msg.type === 'PONG') {
      setIsSynced(true);
      setLastPing(Date.now());
      return;
    }

    if (view === 'player') {
      switch (msg.type) {
        case 'INIT':
          setFileName(msg.fileName);
          setIsImage(msg.isImage);
          loadMediaFromDB(msg.mediaId);
          break;
        case 'PLAY':
          videoRef.current?.play().catch(console.error);
          setIsPlaying(true);
          break;
        case 'PAUSE':
          videoRef.current?.pause();
          setIsPlaying(false);
          break;
        case 'SEEK':
          if (videoRef.current) {
            videoRef.current.currentTime = msg.time;
          }
          break;
        case 'PLAYLIST_UPDATE':
          setPlaylist(msg.items);
          break;
      }
    } else if (view === 'controller') {
      if (msg.type === 'SYNC_REQUEST') {
        console.log('[SyncSplit] Received SYNC_REQUEST');
        postMessageRef.current({ type: 'PLAYLIST_UPDATE', items: playlist });
        if (playlist[currentIndex]) {
          const item = playlist[currentIndex];
          postMessageRef.current({ 
            type: 'INIT', 
            fileName: item.name, 
            mediaId: item.id,
            isImage: item.type.startsWith('image/'),
            duration: item.duration
          });
          if (videoRef.current && !item.type.startsWith('image/')) {
            postMessageRef.current({ type: 'SEEK', time: videoRef.current.currentTime });
            if (isPlaying) postMessageRef.current({ type: 'PLAY' });
          }
        }
      }
    }
  }, [view, videoFile, fileName, isPlaying, loadMediaFromDB, playlist, currentIndex]);

  const { postMessage } = useBroadcastChannel(handleMessage);

  useEffect(() => {
    postMessageRef.current = postMessage;
  }, [postMessage]);

  // Heartbeat to check connection
  useEffect(() => {
    const interval = setInterval(() => {
      postMessageRef.current({ type: 'PING', timestamp: Date.now() });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Check for sync timeout
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastPing > 5000) {
        setIsSynced(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lastPing]);

  // Load library on mount
  useEffect(() => {
    const init = async () => {
      const lib = await getLibrary();
      setPlaylist(lib);
      const saved = localStorage.getItem('sync-split-saved-playlists');
      if (saved) setSavedPlaylists(JSON.parse(saved));
    };
    init();
  }, []);

  const saveCurrentPlaylist = () => {
    const newSaved = [...savedPlaylists, { name: playlistName, items: playlist }];
    setSavedPlaylists(newSaved);
    localStorage.setItem('sync-split-saved-playlists', JSON.stringify(newSaved));
    setPlaylistName('New Playlist');
  };

  const loadSavedPlaylist = (items: MediaMetadata[]) => {
    setPlaylist(items);
    setCurrentIndex(0);
    saveLibrary(items);
    postMessageRef.current({ type: 'PLAYLIST_UPDATE', items });
  };

  const deleteSavedPlaylist = (index: number) => {
    const newSaved = savedPlaylists.filter((_, i) => i !== index);
    setSavedPlaylists(newSaved);
    localStorage.setItem('sync-split-saved-playlists', JSON.stringify(newSaved));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const newItems: MediaMetadata[] = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const id = Math.random().toString(36).substring(7);
        const isImg = file.type.startsWith('image/');
        
        const metadata: MediaMetadata = {
          id,
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          duration: isImg ? 5 : undefined
        };

        await saveMediaToDB(file, id);
        newItems.push(metadata);
      }

      const updatedPlaylist = [...playlist, ...newItems];
      setPlaylist(updatedPlaylist);
      await saveLibrary(updatedPlaylist);
      postMessageRef.current({ type: 'PLAYLIST_UPDATE', items: updatedPlaylist });
    }
  };

  const removeFromPlaylist = async (id: string) => {
    const updated = playlist.filter(item => item.id !== id);
    setPlaylist(updated);
    await saveLibrary(updated);
    await deleteMedia(id);
    postMessageRef.current({ type: 'PLAYLIST_UPDATE', items: updated });
    
    if (currentIndex >= updated.length && updated.length > 0) {
      setCurrentIndex(updated.length - 1);
    }
  };

  const updateItemDuration = async (id: string, duration: number) => {
    const updated = playlist.map(item => item.id === id ? { ...item, duration } : item);
    setPlaylist(updated);
    await saveLibrary(updated);
    postMessageRef.current({ type: 'PLAYLIST_UPDATE', items: updated });
  };

  const moveItem = async (from: number, to: number) => {
    const updated = [...playlist];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setPlaylist(updated);
    await saveLibrary(updated);
    postMessageRef.current({ type: 'PLAYLIST_UPDATE', items: updated });
  };

  const togglePlay = () => {
    const videos = document.querySelectorAll('video');
    if (isPlaying) {
      videos.forEach(v => v.pause());
      postMessageRef.current({ type: 'PAUSE' });
    } else {
      videos.forEach(v => v.play().catch(console.error));
      postMessageRef.current({ type: 'PLAY' });
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const videos = document.querySelectorAll('video');
    videos.forEach(v => {
      v.currentTime = time;
    });
    setCurrentTime(time);
    postMessageRef.current({ type: 'SEEK', time });
  };

  const launchPlayer = (p: number) => {
    const url = `${window.location.origin}${window.location.pathname}?view=player&part=${p}`;
    window.open(url, `player-${p}`, 'width=540,height=960');
  };

  const launchAll = () => {
    [0, 1, 2].forEach(launchPlayer);
  };

  // Update current time for controller
  useEffect(() => {
    if (view === 'controller' && isPlaying) {
      const interval = setInterval(() => {
        if (videoRef.current) {
          setCurrentTime(videoRef.current.currentTime);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isPlaying, view]);

  if (view === 'player') {
    return (
      <div className="fixed inset-0 bg-bg flex items-center justify-center overflow-hidden">
        {!isPlayerReady && (
          <div className="absolute inset-0 z-50 bg-bg/90 backdrop-blur-md flex flex-col items-center justify-center p-12 text-center space-y-6">
            <div className="w-16 h-16 bg-accent rounded-full flex items-center justify-center animate-pulse">
              <Monitor size={32} className="text-white" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black uppercase tracking-tighter">Display {part + 1} Ready</h2>
              <p className="text-text-muted text-sm max-w-xs mx-auto">Click to activate this display and enable synchronized playback.</p>
            </div>
            <button 
              onClick={() => {
                setIsPlayerReady(true);
                if (isPlaying) videoRef.current?.play().catch(console.error);
              }}
              className="btn-primary px-12 py-4 text-lg"
            >
              Activate Display
            </button>
          </div>
        )}
        {!remoteStream && !videoUrl ? (
          <div className="flex flex-col items-center gap-6">
            <div className="text-text-muted font-mono text-sm animate-pulse">
              WAITING FOR SOURCE... (PART {part + 1})
            </div>
            <button 
              onClick={() => postMessageRef.current({ type: 'SYNC_REQUEST' })}
              className="px-4 py-2 border border-border rounded text-[10px] font-mono text-text-muted hover:text-text hover:border-accent transition-colors"
            >
              RETRY SYNC
            </button>
          </div>
        ) : (
          <div 
            className="relative w-full h-full flex items-center justify-center"
            style={{ 
              aspectRatio: '9/16',
            }}
          >
            {isImage ? (
              <img 
                src={videoUrl || undefined}
                className="absolute h-full w-auto max-w-none"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: `translate(-50%, -50%) translateX(${(1 - part) * 33.33}%) scale(${zoom / 100}) translateX(${offsetX}px)`,
                }}
                referrerPolicy="no-referrer"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={remoteStream ? undefined : videoUrl || undefined}
                  autoPlay
                  muted
                  playsInline
                  className="absolute h-full w-auto max-w-none"
                  style={{
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) translateX(${(1 - part) * 33.33}%) scale(${zoom / 100}) translateX(${offsetX}px)`,
                  }}
                  onEnded={onVideoEnded}
                />
                {remoteStream && (
                  <video
                    ref={(el) => {
                      if (el) el.srcObject = remoteStream;
                    }}
                    autoPlay
                    muted
                    playsInline
                    className="absolute h-full w-auto max-w-none"
                    style={{
                      left: '50%',
                      top: '50%',
                      transform: `translate(-50%, -50%) translateX(${(1 - part) * 33.33}%) scale(${zoom / 100}) translateX(${offsetX}px)`,
                    }}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg text-text font-sans selection:bg-accent selection:text-white">
      {/* Header */}
      <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-accent rounded" />
          <h1 className="text-lg font-semibold tracking-tight uppercase">Triptych Sync v2.4</h1>
        </div>
        <div className="flex items-center gap-6">
          <button 
            onClick={() => window.open(window.location.href, '_blank')}
            className="flex items-center gap-2 px-3 py-1.5 border border-border rounded text-[10px] font-mono text-text-muted hover:text-text hover:border-accent transition-colors"
            title="Open controller in a new tab to bypass iframe restrictions"
          >
            <ExternalLink size={14} />
            NEW TAB
          </button>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase">
              <span className="text-text-muted">Sync Status:</span>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${isSynced ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 animate-pulse'}`} />
                <span className={isSynced ? 'text-green-500' : 'text-red-500'}>
                  {isSynced ? 'Connected' : 'Searching...'}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <div className={`w-2 h-2 rounded-full ${videoUrl ? 'bg-blue-500' : 'bg-zinc-700'}`} />
            <span>{videoUrl ? `Source: ${fileName}` : 'No Active Source'}</span>
          </div>
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className="p-2 text-text-muted hover:text-text transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 flex p-6 gap-6 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-[320px] flex flex-col gap-4 shrink-0 overflow-y-auto">
          <div className="card">
            <div className="card-title flex justify-between items-center">
              <span>Playlist</span>
              <label className="cursor-pointer p-1 bg-accent/10 text-accent rounded hover:bg-accent/20 transition-colors">
                <Plus size={14} />
                <input type="file" multiple accept="video/*,image/*" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>
            
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {playlist.length === 0 ? (
                <div className="border border-dashed border-border rounded-lg p-6 text-center space-y-2">
                  <Upload size={20} className="mx-auto text-text-muted" />
                  <p className="text-[10px] text-text-muted uppercase">Empty Playlist</p>
                </div>
              ) : (
                <Reorder.Group axis="y" values={playlist} onReorder={(newOrder) => {
                  setPlaylist(newOrder);
                  saveLibrary(newOrder);
                  postMessageRef.current({ type: 'PLAYLIST_UPDATE', items: newOrder });
                }} className="space-y-2">
                  {playlist.map((item, index) => (
                    <Reorder.Item 
                      key={item.id} 
                      value={item}
                      className={`group p-2 rounded border transition-all flex items-center gap-2 cursor-pointer ${currentIndex === index ? 'bg-accent/10 border-accent/50' : 'bg-pane-bg border-border hover:border-text-muted'}`}
                      onClick={() => setCurrentIndex(index)}
                    >
                      <div className="text-text-muted cursor-grab active:cursor-grabbing">
                        <GripVertical size={12} />
                      </div>
                      <div className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${item.type.startsWith('image/') ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'}`}>
                        {item.type.startsWith('image/') ? <ImageIcon size={14} /> : <Film size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium truncate">{item.name}</p>
                        {item.type.startsWith('image/') && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[8px] text-text-muted uppercase">Dur:</span>
                            <input 
                              type="number" 
                              value={item.duration || 5} 
                              onChange={(e) => updateItemDuration(item.id, parseInt(e.target.value))}
                              className="w-8 bg-black/40 border-none text-[8px] p-0 text-center rounded focus:ring-0"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-[8px] text-text-muted">s</span>
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromPlaylist(item.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-red-400 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </Reorder.Item>
                  ))}
                </Reorder.Group>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-muted uppercase font-mono">Loop Playlist</span>
                <button 
                  onClick={() => setIsLooping(!isLooping)}
                  className={`w-8 h-4 rounded-full transition-colors relative ${isLooping ? 'bg-accent' : 'bg-zinc-700'}`}
                >
                  <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${isLooping ? 'left-4.5' : 'left-0.5'}`} />
                </button>
              </div>
              
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={playlistName}
                    onChange={(e) => setPlaylistName(e.target.value)}
                    className="flex-1 bg-black/40 border border-border rounded px-2 py-1 text-[10px] focus:border-accent outline-none"
                    placeholder="Playlist Name"
                  />
                  <button 
                    onClick={saveCurrentPlaylist}
                    className="px-2 py-1 bg-accent/10 text-accent rounded text-[10px] font-bold hover:bg-accent/20 transition-colors"
                  >
                    SAVE
                  </button>
                </div>
                
                {savedPlaylists.length > 0 && (
                  <div className="space-y-1 mt-2">
                    <p className="text-[8px] text-text-muted uppercase tracking-widest mb-1">Saved Playlists</p>
                    {savedPlaylists.map((sp, i) => (
                      <div key={i} className="flex items-center justify-between group bg-black/20 p-1.5 rounded border border-transparent hover:border-border transition-all">
                        <button 
                          onClick={() => loadSavedPlaylist(sp.items)}
                          className="text-[10px] text-text-muted hover:text-text truncate flex-1 text-left"
                        >
                          {sp.name}
                        </button>
                        <button 
                          onClick={() => deleteSavedPlaylist(i)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-red-400"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Monitor Mapping</div>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[0, 1, 2].map(p => (
                <button
                  key={p}
                  onClick={() => launchPlayer(p)}
                  className="aspect-[9/16] bg-pane-bg border border-border rounded flex flex-col items-center justify-center gap-1 hover:border-accent transition-all group"
                >
                  <span className="font-mono text-lg font-bold">{p + 1}</span>
                  <span className="text-[7px] uppercase tracking-widest text-text-muted group-hover:text-accent">Launch</span>
                </button>
              ))}
            </div>
            <button 
              onClick={launchAll}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <ExternalLink size={14} />
              Launch All
            </button>
          </div>
        </aside>

        {/* Stage */}
        <section className="flex-1 bg-black rounded-xl border border-border flex items-center justify-center relative overflow-hidden">
          {videoUrl && (
            <video 
              id="master-video"
              src={videoUrl}
              className="hidden"
              muted
              playsInline
            />
          )}
          <div className="flex gap-2 h-[480px]">
            {[0, 1, 2].map(p => (
              <div key={p} className="w-[270px] h-full bg-pane-bg border-2 border-border relative flex flex-col overflow-hidden">
                <div className="flex-1 bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center">
                  {videoUrl && (
                    <>
                      {isImage ? (
                        <img 
                          src={videoUrl}
                          className="h-full w-auto max-w-none opacity-40"
                          style={{
                            transform: `translateX(${(1 - p) * 33.33}%) scale(${zoom / 100})`,
                          }}
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <video 
                          ref={p === 1 ? videoRef : null}
                          src={videoUrl}
                          className="h-full w-auto max-w-none opacity-40"
                          style={{
                            transform: `translateX(${(1 - p) * 33.33}%) scale(${zoom / 100})`,
                          }}
                          onLoadedMetadata={(e) => {
                            if (p === 1) setDuration(e.currentTarget.duration);
                          }}
                          muted
                        />
                      )}
                    </>
                  )}
                  {!videoUrl && (
                    <div className="w-full h-10 bg-[repeating-linear-gradient(90deg,transparent,transparent_2px,var(--color-accent)_2px,var(--color-accent)_4px)] opacity-30" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="h-20 bg-surface border-t border-border px-6 flex items-center gap-5 shrink-0">
        <div className="font-mono text-sm text-text-muted w-24">
          {new Date(currentTime * 1000).toISOString().substr(11, 8)}
        </div>
        
        <div className="flex-1 h-1 bg-border rounded-full relative group cursor-pointer">
          <input 
            type="range" 
            min={0} 
            max={duration || 100} 
            step={0.01}
            value={currentTime}
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div 
            className="h-full bg-accent rounded-full relative"
            style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg scale-0 group-hover:scale-100 transition-transform" />
          </div>
        </div>

        <div className="font-mono text-sm text-text-muted w-24 text-right">
          {new Date(duration * 1000).toISOString().substr(11, 8)}
        </div>

        <div className="flex items-center gap-4 pl-6 border-l border-border">
          <button 
            onClick={() => {
              const videos = document.querySelectorAll('video');
              videos.forEach(v => v.currentTime = 0);
              setCurrentTime(0);
              postMessageRef.current({ type: 'SEEK', time: 0 });
            }}
            disabled={!videoUrl}
            className="text-text-muted hover:text-text disabled:opacity-20 transition-colors"
            title="Reset to Start"
          >
            <RotateCcw size={20} />
          </button>
          <button 
            onClick={() => {
              if (videoRef.current) {
                postMessageRef.current({ type: 'SEEK', time: videoRef.current.currentTime });
                if (isPlaying) postMessageRef.current({ type: 'PLAY' });
              }
            }}
            disabled={!videoUrl}
            className="text-text-muted hover:text-text disabled:opacity-20 transition-colors"
            title="Force Sync All Displays"
          >
            <Maximize size={20} />
          </button>
          <button 
            onClick={togglePlay}
            disabled={!videoUrl}
            className="w-10 h-10 bg-accent text-white rounded-full flex items-center justify-center hover:opacity-90 disabled:opacity-20 transition-all"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-1" />}
          </button>
        </div>
      </footer>

      {/* Calibration Overlay */}
      <AnimatePresence>
        {isSettingsOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />
            <motion.div 
              initial={{ opacity: 0, x: 300 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 300 }}
              className="fixed top-0 right-0 h-full w-80 bg-surface border-l border-border z-50 p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="font-bold uppercase text-sm tracking-widest">Calibration</h3>
                <button onClick={() => setIsSettingsOpen(false)} className="text-[10px] font-mono uppercase underline text-text-muted hover:text-text">Close</button>
              </div>

              <div className="space-y-8">
                <div className="space-y-3">
                  <label className="text-[11px] font-mono uppercase text-text-muted">Global Zoom (%)</label>
                  <input 
                    type="range" min="50" max="150" value={zoom} 
                    onChange={(e) => setZoom(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-full appearance-none accent-accent"
                  />
                  <div className="flex justify-between font-mono text-[10px] text-text-muted">
                    <span>50%</span>
                    <span className="text-accent font-bold">{zoom}%</span>
                    <span>150%</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[11px] font-mono uppercase text-text-muted">Horizontal Shift (px)</label>
                  <input 
                    type="range" min="-500" max="500" value={offsetX} 
                    onChange={(e) => setOffsetX(parseInt(e.target.value))}
                    className="w-full h-1 bg-border rounded-full appearance-none accent-accent"
                  />
                  <div className="flex justify-between font-mono text-[10px] text-text-muted">
                    <span>-500px</span>
                    <span className="text-accent font-bold">{offsetX}px</span>
                    <span>500px</span>
                  </div>
                </div>

                <div className="p-4 bg-accent/10 border border-accent/20 rounded-lg space-y-2">
                  <div className="flex items-center gap-2 text-accent">
                    <Info size={14} />
                    <span className="text-[10px] font-bold uppercase">Calibration Note</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-text-muted">
                    Adjust these values to align the video across physical monitor bezels. These settings are applied in real-time to all connected displays.
                  </p>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
