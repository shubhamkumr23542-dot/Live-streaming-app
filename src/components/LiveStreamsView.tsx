import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Gift,
  Mic,
  MicOff,
  PhoneCall,
  Radio,
  Send,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  createLiveStreamDoc,
  endLiveStreamDoc,
  makeUniqueId,
  recordCoinChange,
  saveStreamMessageDoc,
  updateOnlineAndRate,
} from '../lib/firestoreActions';
import { soundFx } from '../lib/soundFx';
import type { LiveStreamSummary, UserProfile } from '../types/app';
import { GENERATED_IMAGES } from './BrandAssets';

interface StreamChatMsg {
  id: string;
  senderName: string;
  text: string;
  giftName?: string;
  giftCoins?: number;
}

interface LiveStreamsViewProps {
  profile: UserProfile;
  liveStreams: LiveStreamSummary[];
  sendWs: (payload: Record<string, unknown>) => void;
  wsEmitter: EventTarget;
  onBalanceChange: (newBalance: number) => void;
  onStartDirectCall: (calleeId: string, calleeName: string, ratePerMin: number) => void;
  onOpenCoins: () => void;
}

const STREAM_CATEGORIES = ['Adda & Chai', 'Music & Singing', 'Ludo Live', 'Shayari & Comedy'];

const VIRTUAL_GIFTS = [
  { name: 'Masala Chai', coins: 10 },
  { name: 'Red Rose', coins: 25 },
  { name: 'Festive Diya', coins: 50 },
  { name: 'Royal Crown', coins: 200 },
];

const SHOWCASE_SPOTS = [
  {
    city: 'Mumbai',
    language: 'Hindi · Acoustic',
    title: 'Late Night Unplugged & Request Session',
    category: 'Music & Singing',
    image: GENERATED_IMAGES.creatorMumbai,
  },
  {
    city: 'New Delhi',
    language: 'Hinglish · Talk',
    title: 'Delhi Adda: Cricket, Tech & Live Q&A',
    category: 'Adda & Chai',
    image: GENERATED_IMAGES.creatorDelhi,
  },
  {
    city: 'Jaipur',
    language: 'Hindi · Rooftop',
    title: 'Sunset Terrace Stories & Ludo Challenges',
    category: 'Shayari & Comedy',
    image: GENERATED_IMAGES.creatorJaipur,
  },
];

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const LiveStreamsView: React.FC<LiveStreamsViewProps> = ({
  profile,
  liveStreams,
  sendWs,
  wsEmitter,
  onBalanceChange,
  onStartDirectCall,
  onOpenCoins,
}) => {
  const [selectedLang, setSelectedLang] = useState('All');
  const [showGoLiveModal, setShowGoLiveModal] = useState(false);
  const [streamTitle, setStreamTitle] = useState('');
  const [streamCategory, setStreamCategory] = useState(STREAM_CATEGORIES[0]);
  const [callRate, setCallRate] = useState(20);

  const [hostingStreamId, setHostingStreamId] = useState<string | null>(null);
  const [watchingStream, setWatchingStream] = useState<LiveStreamSummary | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [camMuted, setCamMuted] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<StreamChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [giftToast, setGiftToast] = useState<string | null>(null);

  const hostVideoRef = useRef<HTMLVideoElement | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    localStreamRef.current = localStream;
    if (hostVideoRef.current && localStream) {
      hostVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (viewerVideoRef.current && remoteStream) {
      viewerVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    const onWsMessage = async (ev: Event) => {
      const msg = (ev as CustomEvent).detail;
      const activeId = hostingStreamId || watchingStream?.streamId;
      if (!msg) return;

      if (msg.type === 'stream:chat' && msg.streamId === activeId) {
        setChatMessages((prev) => [
          ...prev.slice(-60),
          {
            id: `${msg.createdAt}_${Math.random()}`,
            senderName: msg.senderName,
            text: msg.text,
            giftName: msg.giftName,
            giftCoins: msg.giftCoins,
          },
        ]);
        if (msg.giftCoins > 0) {
          soundFx.coinEarned();
          setGiftToast(`${msg.senderName} sent ${msg.giftName} (${msg.giftCoins} coins)`);
          setTimeout(() => setGiftToast(null), 3500);
        }
      }

      // Host receives new viewer -> initiate WebRTC offer
      if (msg.type === 'stream:viewer_joined' && hostingStreamId && msg.streamId === hostingStreamId) {
        const viewerId = String(msg.viewerId);
        const pc = new RTCPeerConnection(RTC_CONFIG);
        peerConnectionsRef.current.set(viewerId, pc);
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((track) => {
            pc.addTrack(track, localStreamRef.current!);
          });
        }
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            sendWs({
              type: 'stream:signal',
              streamId: hostingStreamId,
              targetId: viewerId,
              signal: { candidate: e.candidate },
            });
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs({
          type: 'stream:signal',
          streamId: hostingStreamId,
          targetId: viewerId,
          signal: { sdp: pc.localDescription },
        });
      }

      if (msg.type === 'stream:signal' && msg.streamId === activeId) {
        const fromId = String(msg.fromId);
        const signal = msg.signal;
        if (hostingStreamId) {
          const pc = peerConnectionsRef.current.get(fromId);
          if (!pc) return;
          if (signal.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          } else if (signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        } else if (watchingStream) {
          let pc = peerConnectionsRef.current.get(fromId);
          if (!pc) {
            pc = new RTCPeerConnection(RTC_CONFIG);
            peerConnectionsRef.current.set(fromId, pc);
            pc.ontrack = (event) => {
              if (event.streams && event.streams[0]) {
                setRemoteStream(event.streams[0]);
              }
            };
            pc.onicecandidate = (e) => {
              if (e.candidate) {
                sendWs({
                  type: 'stream:signal',
                  streamId: watchingStream.streamId,
                  targetId: fromId,
                  signal: { candidate: e.candidate },
                });
              }
            };
          }
          if (signal.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            if (signal.sdp.type === 'offer') {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              sendWs({
                type: 'stream:signal',
                streamId: watchingStream.streamId,
                targetId: fromId,
                signal: { sdp: pc.localDescription },
              });
            }
          } else if (signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
        }
      }

      if (msg.type === 'stream:ended' && watchingStream && msg.streamId === watchingStream.streamId) {
        cleanupMediaAndPeers();
        setWatchingStream(null);
      }
    };

    wsEmitter.addEventListener('ws-message', onWsMessage);
    return () => wsEmitter.removeEventListener('ws-message', onWsMessage);
  }, [hostingStreamId, watchingStream, sendWs, wsEmitter]);

  const cleanupMediaAndPeers = () => {
    for (const pc of peerConnectionsRef.current.values()) {
      pc.close();
    }
    peerConnectionsRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      setLocalStream(null);
    }
    setRemoteStream(null);
    setMediaNotice(null);
  };

  useEffect(() => {
    return () => cleanupMediaAndPeers();
  }, []);

  const handleStartLive = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = streamTitle.trim() || `${profile.displayName}'s Live Room`;
    const newStreamId = makeUniqueId('live');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      setMediaNotice(null);
    } catch {
      setMediaNotice('Camera or mic permission unavailable — broadcasting in Audio/Chat Studio mode.');
    }

    await createLiveStreamDoc({
      streamId: newStreamId,
      hostId: profile.uid,
      hostName: profile.displayName,
      hostCity: profile.city,
      title,
      category: streamCategory,
      language: profile.language,
      callRatePerMin: callRate,
    });
    await updateOnlineAndRate(profile.uid, { isLive: true, callRatePerMin: callRate });

    sendWs({
      type: 'stream:start',
      streamId: newStreamId,
      title,
      category: streamCategory,
    });

    setChatMessages([
      {
        id: 'sys_start',
        senderName: 'RangLive',
        text: `Live room "${title}" started from ${profile.city}.`,
      },
    ]);
    setHostingStreamId(newStreamId);
    setShowGoLiveModal(false);
  };

  const handleStopLive = async () => {
    if (!hostingStreamId) return;
    sendWs({ type: 'stream:stop', streamId: hostingStreamId });
    await endLiveStreamDoc(hostingStreamId);
    await updateOnlineAndRate(profile.uid, { isLive: false });
    cleanupMediaAndPeers();
    setHostingStreamId(null);
    setChatMessages([]);
  };

  const handleJoinStream = (stream: LiveStreamSummary) => {
    if (stream.hostId === profile.uid) return;
    cleanupMediaAndPeers();
    setWatchingStream(stream);
    setChatMessages([
      {
        id: 'sys_join',
        senderName: 'RangLive',
        text: `Joined ${stream.hostName}'s live room from ${stream.hostCity}.`,
      },
    ]);
    sendWs({ type: 'stream:join', streamId: stream.streamId });
  };

  const handleLeaveStream = () => {
    if (!watchingStream) return;
    sendWs({ type: 'stream:leave', streamId: watchingStream.streamId });
    cleanupMediaAndPeers();
    setWatchingStream(null);
    setChatMessages([]);
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeId = hostingStreamId || watchingStream?.streamId;
    const text = chatInput.trim();
    if (!activeId || !text) return;
    setChatInput('');
    sendWs({
      type: 'stream:chat',
      streamId: activeId,
      text,
      giftName: '',
      giftCoins: 0,
    });
    await saveStreamMessageDoc({
      streamId: activeId,
      senderId: profile.uid,
      senderName: profile.displayName,
      text,
      giftName: '',
      giftCoins: 0,
    });
  };

  const handleSendGift = async (gift: { name: string; coins: number }) => {
    const activeId = watchingStream?.streamId;
    if (!activeId || !watchingStream) return;
    if (profile.coins < gift.coins) {
      onOpenCoins();
      return;
    }
    const newBal = await recordCoinChange({
      uid: profile.uid,
      currentCoins: profile.coins,
      currentEarned: profile.totalEarnedCoins,
      delta: -gift.coins,
      type: 'gift_send',
      description: `Sent ${gift.name} to ${watchingStream.hostName}`,
    });
    onBalanceChange(newBal);
    sendWs({
      type: 'stream:chat',
      streamId: activeId,
      text: `sent a ${gift.name}`,
      giftName: gift.name,
      giftCoins: gift.coins,
    });
    await saveStreamMessageDoc({
      streamId: activeId,
      senderId: profile.uid,
      senderName: profile.displayName,
      text: `sent a ${gift.name}`,
      giftName: gift.name,
      giftCoins: gift.coins,
    });
  };

  const toggleMic = () => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = micMuted;
    });
    setMicMuted(!micMuted);
  };

  const toggleCam = () => {
    if (!localStream) return;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = camMuted;
    });
    setCamMuted(!camMuted);
  };

  const languages = ['All', 'Hindi', 'Hinglish', 'English', 'Marathi', 'Tamil', 'Bengali', 'Punjabi'];
  const filteredStreams = liveStreams.filter(
    (s) => selectedLang === 'All' || s.language.toLowerCase() === selectedLang.toLowerCase()
  );

  // Active Broadcast or Watching Stage
  if (hostingStreamId || watchingStream) {
    const activeTitle = watchingStream ? watchingStream.title : streamTitle || `${profile.displayName}'s Live Room`;
    const activeHost = watchingStream ? watchingStream.hostName : profile.displayName;
    const activeCity = watchingStream ? watchingStream.hostCity : profile.city;
    const activeViewerCount = watchingStream
      ? watchingStream.viewerCount
      : liveStreams.find((s) => s.streamId === hostingStreamId)?.viewerCount || 0;

    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Video Stage */}
        <div className="lg:col-span-8 rounded-3xl bg-[#131822] border border-white/10 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-rose-400 font-semibold">
                <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>LIVE</span>
                <span className="text-slate-500" aria-hidden="true">·</span>
                <span className="text-slate-300 font-normal truncate">
                  {activeHost} · {activeCity}
                </span>
              </div>
              <h2 className="font-display text-lg font-semibold text-white truncate mt-0.5">
                {activeTitle}
              </h2>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="flex items-center gap-1.5 text-xs font-mono text-slate-300 tabular-nums">
                <Users className="w-3.5 h-3.5 text-amber-400" />
                {activeViewerCount} watching
              </span>
              {hostingStreamId ? (
                <button
                  onClick={handleStopLive}
                  className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  End Stream
                </button>
              ) : (
                <button
                  onClick={handleLeaveStream}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Leave Room
                </button>
              )}
            </div>
          </div>

          <div className="relative flex-1 min-h-[340px] md:min-h-[460px] bg-[#0B0E14] flex items-center justify-center">
            {hostingStreamId && localStream && !camMuted ? (
              <video
                ref={hostVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
              />
            ) : watchingStream && remoteStream ? (
              <video
                ref={viewerVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center p-8 space-y-3 max-w-md">
                <div className="w-20 h-20 rounded-full bg-amber-500/15 border border-amber-500/30 mx-auto flex items-center justify-center font-display text-3xl font-bold text-amber-400">
                  {activeHost.charAt(0).toUpperCase()}
                </div>
                <div className="font-display text-lg font-semibold text-white">
                  {activeHost} is Live
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {mediaNotice ||
                    (watchingStream
                      ? 'Connecting live audio & video stream via WebRTC...'
                      : 'Camera is paused. Viewers can still chat and send virtual gifts.')}
                </p>
              </div>
            )}

            {giftToast && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 rounded-xl bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold shadow-lg flex items-center gap-2">
                <Gift className="w-4 h-4" />
                <span>{giftToast}</span>
              </div>
            )}
          </div>

          {/* Host Controls or Viewer Quick Actions */}
          <div className="px-5 py-3.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 bg-[#131822]">
            {hostingStreamId ? (
              <div className="flex items-center gap-2.5">
                <button
                  onClick={toggleMic}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    micMuted ? 'bg-rose-500/20 text-rose-300' : 'bg-white/10 text-white hover:bg-white/15'
                  }`}
                >
                  {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {micMuted ? 'Unmute Mic' : 'Mute Mic'}
                </button>
                <button
                  onClick={toggleCam}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                    camMuted ? 'bg-rose-500/20 text-rose-300' : 'bg-white/10 text-white hover:bg-white/15'
                  }`}
                >
                  {camMuted ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                  {camMuted ? 'Start Camera' : 'Pause Camera'}
                </button>
              </div>
            ) : (
              watchingStream && (
                <div className="flex flex-wrap items-center gap-2">
                  {VIRTUAL_GIFTS.map((gift) => (
                    <button
                      key={gift.name}
                      onClick={() => handleSendGift(gift)}
                      className="px-3 py-2 rounded-xl bg-[#0B0E14] border border-white/10 hover:border-amber-500/50 text-xs text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Gift className="w-3.5 h-3.5 text-amber-400" />
                      <span>{gift.name}</span>
                      <span className="font-mono text-amber-400 tabular-nums">{gift.coins}</span>
                    </button>
                  ))}
                </div>
              )
            )}

            {watchingStream && (
              <button
                onClick={() =>
                  onStartDirectCall(
                    watchingStream.hostId,
                    watchingStream.hostName,
                    watchingStream.callRatePerMin
                  )
                }
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>1-on-1 Call ({watchingStream.callRatePerMin}/min)</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Room Chat Panel */}
        <div className="lg:col-span-4 rounded-3xl bg-[#131822] border border-white/10 flex flex-col min-h-[380px] max-h-[600px]">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-white">Live Room Chat</h3>
            <span className="text-xs font-mono text-amber-400 tabular-nums">
              {profile.coins} coins
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.map((m) => (
              <div
                key={m.id}
                className={`text-sm leading-relaxed ${
                  m.giftCoins ? 'rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2' : ''
                }`}
              >
                <span className="font-semibold text-amber-300 mr-2">{m.senderName}:</span>
                <span className="text-slate-200">{m.text}</span>
                {m.giftCoins ? (
                  <span className="ml-2 font-mono text-xs text-amber-400 tabular-nums">
                    (+{m.giftCoins} coins)
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <form onSubmit={handleSendChat} className="p-3 border-t border-white/10 flex gap-2">
            <input
              type="text"
              maxLength={250}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Say namaste in chat..."
              className="flex-1 rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
            />
            <button
              type="submit"
              className="p-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors cursor-pointer"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-white">
            Live Streams Across India
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Watch regional creators live, send gifts, or start your own camera broadcast.
          </p>
        </div>

        <button
          onClick={() => setShowGoLiveModal(true)}
          className="px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Radio className="w-4 h-4" />
          Go Live Now
        </button>
      </div>

      {/* Language Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {languages.map((lang) => (
          <button
            key={lang}
            onClick={() => setSelectedLang(lang)}
            className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedLang === lang
                ? 'bg-amber-500 text-slate-950'
                : 'bg-[#131822] text-slate-400 hover:text-white border border-white/5'
            }`}
          >
            {lang}
          </button>
        ))}
      </div>

      {/* Active Real-Time Live Streams */}
      {filteredStreams.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredStreams.map((stream) => (
            <div
              key={stream.streamId}
              className="rounded-2xl bg-[#131822] border border-white/10 p-5 flex flex-col justify-between space-y-5"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    LIVE
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {stream.viewerCount} watching
                  </span>
                </div>
                <h3 className="font-display text-lg font-semibold text-white line-clamp-2">
                  {stream.title}
                </h3>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>{stream.hostName}</span>
                  <span aria-hidden="true">·</span>
                  <span>{stream.hostCity}</span>
                  <span aria-hidden="true">·</span>
                  <span>{stream.language}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 pt-3 border-t border-white/5">
                <button
                  onClick={() => handleJoinStream(stream)}
                  disabled={stream.hostId === profile.uid}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
                >
                  {stream.hostId === profile.uid ? 'Your Stream' : 'Watch Live'}
                </button>
                {stream.hostId !== profile.uid && (
                  <button
                    onClick={() =>
                      onStartDirectCall(stream.hostId, stream.hostName, stream.callRatePerMin)
                    }
                    className="py-2.5 px-3 rounded-xl border border-white/10 hover:bg-white/5 text-slate-200 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Video className="w-3.5 h-3.5 text-amber-400" />
                    <span>Call</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-[#131822] border border-white/10 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-display text-base font-semibold text-white">
              No live broadcasts in {selectedLang === 'All' ? 'any channel' : selectedLang} right now
            </h3>
            <p className="text-xs text-slate-400">
              Start a live camera or audio room and invite friends across India to watch and send coin gifts.
            </p>
          </div>
          <button
            onClick={() => setShowGoLiveModal(true)}
            className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            Start First Broadcast
          </button>
        </div>
      )}

      {/* Regional Broadcast Formats */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">
            Popular Formats Across India
          </h2>
          <span className="text-xs text-slate-400">Click any format to go live</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {SHOWCASE_SPOTS.map((spot) => (
            <button
              key={spot.city}
              onClick={() => {
                setStreamCategory(spot.category);
                setStreamTitle(spot.title);
                setShowGoLiveModal(true);
              }}
              className="group text-left rounded-2xl bg-[#131822] border border-white/10 overflow-hidden hover:border-amber-500/40 transition-colors cursor-pointer"
            >
              <div className="aspect-[4/3] w-full overflow-hidden bg-[#0B0E14] relative">
                <img
                  src={spot.image}
                  alt={spot.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#131822] via-transparent to-transparent" />
              </div>
              <div className="p-5 space-y-1.5">
                <div className="text-xs text-amber-400">
                  {spot.city} · {spot.language}
                </div>
                <h3 className="font-display text-base font-semibold text-white">
                  {spot.title}
                </h3>
                <p className="text-xs text-slate-400">Host in {spot.category}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Go Live Modal */}
      {showGoLiveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleStartLive}
            className="w-full max-w-md rounded-3xl bg-[#131822] border border-white/10 p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold text-white">Go Live on RangLive</h3>
              <button
                type="button"
                onClick={() => setShowGoLiveModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-300">Stream Title</label>
              <input
                type="text"
                maxLength={100}
                value={streamTitle}
                onChange={(e) => setStreamTitle(e.target.value)}
                placeholder="e.g. Evening Chai & Music Request"
                className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Category</label>
                <select
                  value={streamCategory}
                  onChange={(e) => setStreamCategory(e.target.value)}
                  className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                >
                  {STREAM_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  1-on-1 Call Rate (Coins/min)
                </label>
                <select
                  value={callRate}
                  onChange={(e) => setCallRate(Number(e.target.value))}
                  className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2.5 text-sm font-mono text-white focus:border-amber-500 focus:outline-none"
                >
                  <option value={10}>10 coins/min</option>
                  <option value={20}>20 coins/min</option>
                  <option value={40}>40 coins/min</option>
                  <option value={75}>75 coins/min</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              Start Live Broadcast
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
