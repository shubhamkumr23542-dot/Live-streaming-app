import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  User,
  Video,
} from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { recordCoinChange } from '../lib/firestoreActions';
import { soundFx } from '../lib/soundFx';
import type { IncomingCallAlert, UserProfile } from '../types/app';

export interface ActiveCallSession {
  callId: string;
  peerId: string;
  peerName: string;
  peerCity: string;
  callType: 'video' | 'audio';
  ratePerMin: number;
  isCaller: boolean;
  status: 'ringing' | 'connected';
}

interface ActiveCallOverlayProps {
  profile: UserProfile;
  incomingCall: IncomingCallAlert | null;
  activeCall: ActiveCallSession | null;
  sendWs: (payload: Record<string, unknown>) => void;
  wsEmitter: EventTarget;
  onAcceptIncoming: () => void;
  onRejectIncoming: () => void;
  onCallEnded: () => void;
  onBalanceChange: (newBal: number) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const ActiveCallOverlay: React.FC<ActiveCallOverlayProps> = ({
  profile,
  incomingCall,
  activeCall,
  sendWs,
  wsEmitter,
  onAcceptIncoming,
  onRejectIncoming,
  onCallEnded,
  onBalanceChange,
}) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [coinsBilled, setCoinsBilled] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const profileCoinsRef = useRef(profile.coins);
  const profileEarnedRef = useRef(profile.totalEarnedCoins);
  const coinsBilledRef = useRef(0);
  const secondsRef = useRef(0);

  profileCoinsRef.current = profile.coins;
  profileEarnedRef.current = profile.totalEarnedCoins;

  useEffect(() => {
    if (incomingCall) {
      soundFx.ring();
      const iv = setInterval(() => soundFx.ring(), 2500);
      return () => clearInterval(iv);
    }
  }, [incomingCall]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const cleanupCall = () => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setSecondsElapsed(0);
    setCoinsBilled(0);
    coinsBilledRef.current = 0;
    secondsRef.current = 0;
    setMediaError(null);
  };

  // Start WebRTC media & signaling when activeCall becomes connected
  useEffect(() => {
    if (!activeCall) {
      cleanupCall();
      return;
    }

    let cancelled = false;

    const initPeer = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: activeCall.callType === 'video',
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        setLocalStream(stream);
      } catch {
        setMediaError('Camera/microphone unavailable — connected in silent mode.');
      }

      if (activeCall.status !== 'connected') return;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.ontrack = (ev) => {
        if (ev.streams && ev.streams[0]) {
          setRemoteStream(ev.streams[0]);
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendWs({
            type: 'call:signal',
            callId: activeCall.callId,
            peerId: activeCall.peerId,
            signal: { candidate: ev.candidate },
          });
        }
      };

      if (activeCall.isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendWs({
          type: 'call:signal',
          callId: activeCall.callId,
          peerId: activeCall.peerId,
          signal: { sdp: pc.localDescription },
        });
      }
    };

    initPeer();

    const onWsSignal = async (ev: Event) => {
      const msg = (ev as CustomEvent).detail;
      if (!msg || msg.callId !== activeCall.callId) return;
      if (msg.type === 'call:signal' && pcRef.current) {
        const sig = msg.signal;
        if (sig.sdp) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sig.sdp));
          if (sig.sdp.type === 'offer') {
            const ans = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(ans);
            sendWs({
              type: 'call:signal',
              callId: activeCall.callId,
              peerId: activeCall.peerId,
              signal: { sdp: pcRef.current.localDescription },
            });
          }
        } else if (sig.candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(sig.candidate));
        }
      }
    };

    wsEmitter.addEventListener('ws-message', onWsSignal);
    return () => {
      cancelled = true;
      wsEmitter.removeEventListener('ws-message', onWsSignal);
    };
  }, [activeCall?.callId, activeCall?.status, sendWs, wsEmitter]);

  // Call timer and per-minute coin billing for caller
  useEffect(() => {
    if (!activeCall || activeCall.status !== 'connected') return;

    const timer = setInterval(async () => {
      secondsRef.current += 1;
      setSecondsElapsed(secondsRef.current);

      // Bill 1 minute upfront at sec 1 and every 60s thereafter for caller
      if (
        activeCall.isCaller &&
        activeCall.ratePerMin > 0 &&
        (secondsRef.current === 1 || secondsRef.current % 60 === 0)
      ) {
        if (profileCoinsRef.current < activeCall.ratePerMin) {
          handleHangup();
          return;
        }
        try {
          const newBal = await recordCoinChange({
            uid: profile.uid,
            currentCoins: profileCoinsRef.current,
            currentEarned: profileEarnedRef.current,
            delta: -activeCall.ratePerMin,
            type: 'call_spend',
            description: `${activeCall.callType === 'video' ? 'Video' : 'Voice'} call with ${activeCall.peerName}`,
          });
          coinsBilledRef.current += activeCall.ratePerMin;
          setCoinsBilled(coinsBilledRef.current);
          onBalanceChange(newBal);
        } catch (err) {
          console.error('Billing error:', err);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeCall?.callId, activeCall?.status]);

  const handleHangup = async () => {
    if (!activeCall) return;
    sendWs({
      type: 'call:end',
      callId: activeCall.callId,
      peerId: activeCall.peerId,
    });
    try {
      await updateDoc(doc(db, 'callRecords', activeCall.callId), {
        status: 'ended',
        durationSec: secondsRef.current,
        coinsSpent: coinsBilledRef.current,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal if call doc already closed
    }
    cleanupCall();
    onCallEnded();
  };

  const toggleMic = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = micMuted;
    });
    setMicMuted(!micMuted);
  };

  const toggleCam = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = camOff;
    });
    setCamOff(!camOff);
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (incomingCall && !activeCall) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
        <div className="w-full max-w-sm rounded-3xl bg-[#131822] border border-amber-500/30 p-6 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-amber-500/15 border border-amber-500/40 mx-auto flex items-center justify-center">
            {incomingCall.callType === 'video' ? (
              <Video className="w-7 h-7 text-amber-400" />
            ) : (
              <PhoneCall className="w-7 h-7 text-amber-400" />
            )}
          </div>
          <div className="space-y-1">
            <div className="text-xs font-semibold text-amber-400">
              Incoming {incomingCall.callType === 'video' ? 'Live Video Call' : 'Voice Call'}
            </div>
            <h3 className="font-display text-2xl font-bold text-white">
              {incomingCall.callerName}
            </h3>
            <p className="text-xs text-slate-400">{incomingCall.callerCity}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onRejectIncoming}
              className="py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              Decline
            </button>
            <button
              onClick={onAcceptIncoming}
              className="py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <PhoneCall className="w-4 h-4" />
              Accept
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeCall) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B0E14] flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-[#131822]">
        <div>
          <h3 className="font-display text-lg font-semibold text-white">
            {activeCall.peerName}
          </h3>
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>{activeCall.peerCity}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-amber-400">
              {activeCall.status === 'ringing' ? 'Ringing...' : formatTimer(secondsElapsed)}
            </span>
            {activeCall.isCaller && activeCall.ratePerMin > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{coinsBilled} coins spent</span>
              </>
            )}
          </div>
        </div>

        <button
          onClick={handleHangup}
          className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
        >
          <PhoneOff className="w-4 h-4" />
          End Call
        </button>
      </div>

      <div className="relative flex-1 flex items-center justify-center p-4 overflow-hidden">
        {remoteStream && activeCall.callType === 'video' ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full max-w-4xl rounded-3xl object-cover bg-[#131822]"
          />
        ) : (
          <div className="text-center space-y-4">
            <div className="w-24 h-24 rounded-full bg-amber-500/15 border border-amber-500/30 mx-auto flex items-center justify-center">
              <User className="w-10 h-10 text-amber-400" />
            </div>
            <div className="font-display text-2xl font-semibold text-white">
              {activeCall.peerName}
            </div>
            <p className="text-sm text-slate-400">
              {activeCall.status === 'ringing'
                ? 'Calling across RangLive...'
                : mediaError || 'Audio/Video channel active'}
            </p>
          </div>
        )}

        {/* Picture-in-Picture Local Camera */}
        {localStream && activeCall.callType === 'video' && !camOff && (
          <div className="absolute bottom-6 right-6 w-32 md:w-48 aspect-[3/4] md:aspect-video rounded-2xl overflow-hidden border border-white/20 shadow-2xl bg-[#131822]">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        )}
      </div>

      <div className="px-6 py-5 border-t border-white/10 bg-[#131822] flex items-center justify-center gap-4">
        <button
          onClick={toggleMic}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
            micMuted ? 'bg-rose-500/20 text-rose-300' : 'bg-white/10 text-white hover:bg-white/15'
          }`}
          aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {activeCall.callType === 'video' && (
          <button
            onClick={toggleCam}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              camOff ? 'bg-rose-500/20 text-rose-300' : 'bg-white/10 text-white hover:bg-white/15'
            }`}
            aria-label={camOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {camOff ? <CameraOff className="w-5 h-5" /> : <Camera className="w-5 h-5" />}
          </button>
        )}

        <button
          onClick={handleHangup}
          className="w-14 h-12 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-colors cursor-pointer"
          aria-label="End call"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
