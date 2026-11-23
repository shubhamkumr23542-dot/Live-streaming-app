import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Coins,
  Dice5,
  Gift,
  LogOut,
  MapPin,
  Phone,
  Radio,
  User as UserIcon,
  Video,
  X,
} from 'lucide-react';
import { ActiveCallOverlay, type ActiveCallSession } from './components/ActiveCallOverlay';
import { AuthGate } from './components/AuthGate';
import { CoinWalletView } from './components/CoinWalletView';
import { LiveStreamsView } from './components/LiveStreamsView';
import { LudoClubView } from './components/LudoClubView';
import { OfflineIndicator, PWAInstallButton } from './components/PWABanners';
import { ReferralView } from './components/ReferralView';
import { VideoCallView } from './components/VideoCallView';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase';
import { makeUniqueId, updateOnlineAndRate } from './lib/firestoreActions';
import type {
  AppTab,
  IncomingCallAlert,
  LiveStreamSummary,
  OnlinePresenceUser,
  OpenLudoRoomSummary,
  UserProfile,
} from './types/app';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<AppTab>('live');
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [showAccountModal, setShowAccountModal] = useState(false);

  // Real-time WebSocket state
  const [onlineUsers, setOnlineUsers] = useState<OnlinePresenceUser[]>([]);
  const [liveStreams, setLiveStreams] = useState<LiveStreamSummary[]>([]);
  const [openRooms, setOpenRooms] = useState<OpenLudoRoomSummary[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCallAlert | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const wsEmitterRef = useRef<EventTarget>(new EventTarget());

  // 1. Track Firebase Auth & Firestore User Profile
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!user) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      setProfileLoading(true);
      unsubProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            setProfile(null);
          }
          setProfileLoading(false);
        },
        (err) => {
          setProfileLoading(false);
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const sendWs = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  // 2. Connect WebSocket when profile is active
  useEffect(() => {
    if (!profile) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    let closedIntentionally = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'auth:register',
            userId: profile.uid,
            displayName: profile.displayName,
            city: profile.city,
            state: profile.state,
            language: profile.language,
            callRatePerMin: 20,
            avatarColor: '#F59E0B',
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'presence:sync') {
            setOnlineUsers(msg.users || []);
            setLiveStreams(msg.streams || []);
            setOpenRooms(msg.ludoRooms || []);
          } else if (msg.type === 'call:incoming') {
            setIncomingCall({
              callId: msg.callId,
              callerId: msg.callerId,
              callerName: msg.callerName,
              callerCity: msg.callerCity,
              callType: msg.callType,
              ratePerMin: msg.ratePerMin,
            });
          } else if (msg.type === 'call:accept') {
            setActiveCall((prev) =>
              prev && prev.callId === msg.callId ? { ...prev, status: 'connected' } : prev
            );
          } else if (msg.type === 'call:reject' || msg.type === 'call:end') {
            setIncomingCall((prev) => (prev?.callId === msg.callId ? null : prev));
            setActiveCall((prev) => (prev?.callId === msg.callId ? null : prev));
            if (msg.type === 'call:reject') {
              setBannerMessage('Call was declined by the recipient.');
            }
          } else if (msg.type === 'call:unavailable') {
            setActiveCall(null);
            setBannerMessage('User is currently offline.');
          }
          wsEmitterRef.current.dispatchEvent(new CustomEvent('ws-message', { detail: msg }));
        } catch (err) {
          console.error('WS parse error:', err);
        }
      };

      ws.onclose = () => {
        if (!closedIntentionally) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();
    updateOnlineAndRate(profile.uid, { isOnline: true }).catch(() => {});

    return () => {
      closedIntentionally = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [profile?.uid]);

  const handleInitiateCall = async (
    calleeId: string,
    calleeName: string,
    calleeCity: string,
    callType: 'video' | 'audio',
    ratePerMin: number
  ) => {
    if (!profile) return;
    if (ratePerMin > 0 && profile.coins < ratePerMin) {
      setBannerMessage(`You need at least ${ratePerMin} coins to start this call.`);
      setActiveTab('coins');
      return;
    }

    const callId = makeUniqueId('call');
    try {
      await setDoc(doc(db, 'callRecords', callId), {
        callId,
        callerId: profile.uid,
        callerName: profile.displayName,
        calleeId,
        calleeName,
        callType,
        ratePerMin,
        status: 'ringing',
        durationSec: 0,
        coinsSpent: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `callRecords/${callId}`);
    }

    sendWs({
      type: 'call:invite',
      callId,
      calleeId,
      callType,
    });

    setActiveCall({
      callId,
      peerId: calleeId,
      peerName: calleeName,
      peerCity: calleeCity,
      callType,
      ratePerMin,
      isCaller: true,
      status: 'ringing',
    });
  };

  const handleAcceptIncoming = async () => {
    if (!incomingCall) return;
    sendWs({
      type: 'call:accept',
      callId: incomingCall.callId,
      peerId: incomingCall.callerId,
    });
    try {
      await updateDoc(doc(db, 'callRecords', incomingCall.callId), {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal
    }
    setActiveCall({
      callId: incomingCall.callId,
      peerId: incomingCall.callerId,
      peerName: incomingCall.callerName,
      peerCity: incomingCall.callerCity,
      callType: incomingCall.callType,
      ratePerMin: incomingCall.ratePerMin,
      isCaller: false,
      status: 'connected',
    });
    setIncomingCall(null);
  };

  const handleRejectIncoming = async () => {
    if (!incomingCall) return;
    sendWs({
      type: 'call:reject',
      callId: incomingCall.callId,
      peerId: incomingCall.callerId,
    });
    try {
      await updateDoc(doc(db, 'callRecords', incomingCall.callId), {
        status: 'missed',
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal
    }
    setIncomingCall(null);
  };

  const handleSignOut = async () => {
    if (profile) {
      await updateOnlineAndRate(profile.uid, { isOnline: false, isLive: false }).catch(() => {});
    }
    await signOut(auth);
    setShowAccountModal(false);
  };

  if (!authReady || profileLoading) {
    return (
      <div className="min-h-screen bg-[#0B0E14] text-slate-200 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="font-display text-2xl font-bold text-white">RangLive</div>
          <p className="text-xs text-slate-400">Connecting to RangLive India...</p>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !profile) {
    return (
      <>
        <AuthGate
          firebaseUser={firebaseUser}
          onProfileCreated={(created, msg) => {
            setProfile(created);
            if (msg) setBannerMessage(msg);
          }}
        />
        <OfflineIndicator />
      </>
    );
  }

  const navItems: { id: AppTab; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    { id: 'live', label: 'Live Streams', shortLabel: 'Live', icon: <Radio className="w-5 h-5" /> },
    { id: 'calls', label: 'Video Call', shortLabel: 'Calls', icon: <Video className="w-5 h-5" /> },
    { id: 'ludo', label: 'Ludo Club', shortLabel: 'Ludo', icon: <Dice5 className="w-5 h-5" /> },
    { id: 'coins', label: 'Coin Store', shortLabel: 'Coins', icon: <Coins className="w-5 h-5" /> },
    { id: 'refer', label: 'Refer & Earn', shortLabel: 'Invite', icon: <Gift className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 pb-20 md:pb-8">
      {/* Strict 3-Zone Desktop Top Bar + Compact Mobile Top Bar */}
      <header className="sticky top-0 z-30 bg-[#0B0E14]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-14 md:h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single Text Brand Mark */}
          <button
            onClick={() => setActiveTab('live')}
            className="font-display text-xl font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            RangLive
          </button>

          {/* Zone 2: Concise Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-7">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`text-sm font-medium whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors cursor-pointer ${
                  activeTab === item.id
                    ? 'text-white border-amber-500'
                    : 'text-slate-400 border-transparent hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <button
            onClick={() => setShowAccountModal(true)}
            className="px-3.5 py-2 rounded-xl bg-[#131822] border border-white/10 hover:border-amber-500/40 text-xs font-semibold text-white flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          >
            <Coins className="w-4 h-4 text-amber-400" />
            <span className="font-mono tabular-nums">{profile.coins.toLocaleString('en-IN')}</span>
            <span className="text-slate-400 hidden sm:inline">· {profile.displayName.split(' ')[0]}</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8 space-y-6">
        {bannerMessage && (
          <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-center justify-between gap-4 text-xs text-amber-200">
            <span>{bannerMessage}</span>
            <button
              onClick={() => setBannerMessage(null)}
              className="text-amber-300 hover:text-white font-semibold cursor-pointer shrink-0"
            >
              Close
            </button>
          </div>
        )}

        {activeTab === 'live' && (
          <LiveStreamsView
            profile={profile}
            liveStreams={liveStreams}
            sendWs={sendWs}
            wsEmitter={wsEmitterRef.current}
            onBalanceChange={(bal) => setProfile((p) => (p ? { ...p, coins: bal } : p))}
            onStartDirectCall={(calleeId, calleeName, rate) =>
              handleInitiateCall(calleeId, calleeName, 'India', 'video', rate)
            }
            onOpenCoins={() => setActiveTab('coins')}
          />
        )}

        {activeTab === 'calls' && (
          <VideoCallView
            profile={profile}
            onlineUsers={onlineUsers}
            onInitiateCall={handleInitiateCall}
          />
        )}

        {activeTab === 'ludo' && (
          <LudoClubView
            profile={profile}
            openRooms={openRooms}
            sendWs={sendWs}
            wsEmitter={wsEmitterRef.current}
            onBalanceChange={(bal) => setProfile((p) => (p ? { ...p, coins: bal } : p))}
            onOpenCoins={() => setActiveTab('coins')}
          />
        )}

        {activeTab === 'coins' && (
          <CoinWalletView
            profile={profile}
            onBalanceChange={(bal) => setProfile((p) => (p ? { ...p, coins: bal } : p))}
          />
        )}

        {activeTab === 'refer' && (
          <ReferralView
            profile={profile}
            onProfileCoinsUpdated={(newCoins, newCount) =>
              setProfile((p) =>
                p ? { ...p, coins: newCoins, referralCount: newCount } : p
              )
            }
          />
        )}
      </main>

      {/* Mobile Fixed Thumb-Zone Bottom Nav Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-[#0B0E14]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5 items-center">
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center h-full transition-colors cursor-pointer ${
                active ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {item.icon}
              <span className="text-[10px] font-medium mt-1">{item.shortLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Account, PWA Install & Wallet Sheet */}
      {showAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-[#131822] border border-white/10 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold text-white">Your Account</h3>
              <button
                onClick={() => setShowAccountModal(false)}
                className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 rounded-2xl bg-[#0B0E14] border border-white/10 p-4 text-sm">
              <div className="flex items-center gap-3">
                <UserIcon className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-semibold text-white">{profile.displayName}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-300">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  {profile.city}, {profile.state} · {profile.language}
                </span>
              </div>
              <div className="flex items-center gap-3 text-slate-300">
                <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-mono">
                  {profile.phoneNumber || 'Not linked'}{' '}
                  {profile.phoneVerified ? '(Verified)' : ''}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <PWAInstallButton />
              <button
                onClick={() => {
                  setShowAccountModal(false);
                  setActiveTab('coins');
                }}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Recharge Coins
              </button>
            </div>

            <button
              onClick={handleSignOut}
              className="w-full py-2.5 px-4 rounded-xl border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Active 1-on-1 Video/Voice Call & Incoming Ring Overlay */}
      <ActiveCallOverlay
        profile={profile}
        incomingCall={incomingCall}
        activeCall={activeCall}
        sendWs={sendWs}
        wsEmitter={wsEmitterRef.current}
        onAcceptIncoming={handleAcceptIncoming}
        onRejectIncoming={handleRejectIncoming}
        onCallEnded={() => setActiveCall(null)}
        onBalanceChange={(bal) => setProfile((p) => (p ? { ...p, coins: bal } : p))}
      />

      <OfflineIndicator />
    </div>
  );
}
