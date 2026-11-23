import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, MapPin, Phone, Search, Video } from 'lucide-react';
import { collection, limit, onSnapshot, query } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type { OnlinePresenceUser, PublicProfile, UserProfile } from '../types/app';

interface VideoCallViewProps {
  profile: UserProfile;
  onlineUsers: OnlinePresenceUser[];
  onInitiateCall: (
    calleeId: string,
    calleeName: string,
    calleeCity: string,
    callType: 'video' | 'audio',
    ratePerMin: number
  ) => void;
}

export const VideoCallView: React.FC<VideoCallViewProps> = ({
  profile,
  onlineUsers,
  onInitiateCall,
}) => {
  const [directoryProfiles, setDirectoryProfiles] = useState<PublicProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [testingCam, setTestingCam] = useState(false);
  const [camPreviewError, setCamPreviewError] = useState<string | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'publicProfiles'), limit(40));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: PublicProfile[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as PublicProfile;
          if (data.uid !== profile.uid) {
            list.push(data);
          }
        });
        setDirectoryProfiles(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'publicProfiles')
    );
    return () => unsub();
  }, [profile.uid]);

  useEffect(() => {
    return () => {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleCamTest = async () => {
    if (testingCam) {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      setTestingCam(false);
      setCamPreviewError(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewStreamRef.current = stream;
      setTestingCam(true);
      setCamPreviewError(null);
      setTimeout(() => {
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      setCamPreviewError('Could not access camera or microphone in this browser.');
    }
  };

  // Merge real-time online WebSocket users with Firestore directory
  const onlineIds = new Set(onlineUsers.map((u) => u.userId));
  const mergedUsers = [
    ...onlineUsers
      .filter((u) => u.userId !== profile.uid)
      .map((u) => ({
        uid: u.userId,
        displayName: u.displayName,
        city: u.city,
        state: u.state,
        language: u.language,
        callRatePerMin: u.callRatePerMin,
        avatarColor: u.avatarColor,
        isOnlineNow: true,
        isLive: u.isLive,
      })),
    ...directoryProfiles
      .filter((p) => !onlineIds.has(p.uid))
      .map((p) => ({
        uid: p.uid,
        displayName: p.displayName,
        city: p.city,
        state: p.state,
        language: p.language,
        callRatePerMin: p.callRatePerMin,
        avatarColor: p.avatarColor,
        isOnlineNow: false,
        isLive: false,
      })),
  ].filter((u) => {
    const matchesSearch =
      !searchTerm ||
      u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.city.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLang =
      languageFilter === 'All' || u.language.toLowerCase() === languageFilter.toLowerCase();
    return matchesSearch && matchesLang;
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold text-white">
            1-on-1 Live Video &amp; Voice Call
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Connect directly with verified members across India using coins per minute.
          </p>
        </div>

        <button
          onClick={toggleCamTest}
          className="px-4 py-2.5 rounded-xl border border-white/15 bg-[#131822] hover:bg-white/5 text-xs font-semibold text-white inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
        >
          {testingCam ? <CameraOff className="w-4 h-4 text-rose-400" /> : <Camera className="w-4 h-4 text-amber-400" />}
          {testingCam ? 'Close Camera Check' : 'Test My Camera & Mic'}
        </button>
      </div>

      {/* Camera Hardware Check Panel */}
      {(testingCam || camPreviewError) && (
        <div className="rounded-2xl bg-[#131822] border border-white/10 p-5 flex flex-col md:flex-row items-center gap-6">
          {testingCam ? (
            <video
              ref={previewVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full md:w-72 aspect-video rounded-xl object-cover bg-[#0B0E14]"
            />
          ) : null}
          <div className="space-y-2">
            <h3 className="font-display text-base font-semibold text-white">
              {camPreviewError ? 'Camera Check Failed' : 'Your Camera & Mic Are Ready'}
            </h3>
            <p className="text-xs text-slate-400 max-w-md">
              {camPreviewError ||
                'Your video and audio feed look clear. Pick any online member below to start a 1-on-1 video call.'}
            </p>
          </div>
        </div>
      )}

      {/* Search & Language Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name or Indian city (Mumbai, Jaipur, Delhi...)"
            className="w-full rounded-xl bg-[#131822] border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
        </div>
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className="rounded-xl bg-[#131822] border border-white/10 px-4 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
        >
          <option value="All">All Languages</option>
          <option value="Hindi">Hindi</option>
          <option value="Hinglish">Hinglish</option>
          <option value="English">English</option>
          <option value="Marathi">Marathi</option>
          <option value="Tamil">Tamil</option>
          <option value="Bengali">Bengali</option>
          <option value="Punjabi">Punjabi</option>
        </select>
      </div>

      {/* Member Directory Grid */}
      {mergedUsers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {mergedUsers.map((member) => (
            <div
              key={member.uid}
              className="rounded-2xl bg-[#131822] border border-white/10 p-5 flex flex-col justify-between space-y-5"
            >
              <div className="flex items-start gap-3.5">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center font-display text-lg font-bold text-slate-950 shrink-0"
                  style={{ backgroundColor: member.avatarColor || '#F59E0B' }}
                >
                  {member.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-white truncate">
                      {member.displayName}
                    </h3>
                    <span
                      className={`text-xs font-medium shrink-0 ${
                        member.isOnlineNow ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {member.isOnlineNow ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                    <span className="truncate">
                      {member.city}, {member.state}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    <span>{member.language}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono text-amber-400 tabular-nums">
                      {member.callRatePerMin} coins/min
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-white/5">
                <button
                  onClick={() =>
                    onInitiateCall(
                      member.uid,
                      member.displayName,
                      member.city,
                      'audio',
                      member.callRatePerMin
                    )
                  }
                  disabled={!member.isOnlineNow}
                  className="py-2.5 px-3 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Phone className="w-3.5 h-3.5 text-amber-400" />
                  Voice Call
                </button>
                <button
                  onClick={() =>
                    onInitiateCall(
                      member.uid,
                      member.displayName,
                      member.city,
                      'video',
                      member.callRatePerMin
                    )
                  }
                  disabled={!member.isOnlineNow}
                  className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Video className="w-3.5 h-3.5" />
                  Video Call
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-[#131822] border border-white/10 p-8 text-center space-y-2">
          <h3 className="font-display text-lg font-semibold text-white">
            No matching members online yet
          </h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Invite friends with your referral code or open a second browser tab to test live 1-on-1 WebRTC video and voice calling immediately.
          </p>
        </div>
      )}
    </div>
  );
};
