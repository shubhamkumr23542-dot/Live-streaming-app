import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Copy, Crown, Dice5, Play, Plus, Star, Users } from 'lucide-react';
import {
  getLegalTokenIndices,
  getTokenGridCoord,
  type LudoColor,
  type LudoRoom,
} from '../shared/ludoEngine';
import {
  recordCoinChange,
  saveLudoMatchResult,
  updateOnlineAndRate,
} from '../lib/firestoreActions';
import { soundFx } from '../lib/soundFx';
import type { OpenLudoRoomSummary, UserProfile } from '../types/app';
import { GENERATED_IMAGES } from './BrandAssets';

interface LudoClubViewProps {
  profile: UserProfile;
  openRooms: OpenLudoRoomSummary[];
  sendWs: (payload: Record<string, unknown>) => void;
  wsEmitter: EventTarget;
  onBalanceChange: (newBalance: number) => void;
  onOpenCoins: () => void;
}

const COLOR_STYLES: Record<
  LudoColor,
  { bg: string; border: string; text: string; yard: string; label: string }
> = {
  red: {
    bg: 'bg-rose-600',
    border: 'border-rose-300',
    text: 'text-rose-400',
    yard: 'bg-rose-950/70 border-rose-500/40',
    label: 'Crimson',
  },
  green: {
    bg: 'bg-emerald-600',
    border: 'border-emerald-300',
    text: 'text-emerald-400',
    yard: 'bg-emerald-950/70 border-emerald-500/40',
    label: 'Emerald',
  },
  yellow: {
    bg: 'bg-amber-500',
    border: 'border-amber-200',
    text: 'text-amber-400',
    yard: 'bg-amber-950/70 border-amber-500/40',
    label: 'Saffron',
  },
  blue: {
    bg: 'bg-blue-600',
    border: 'border-blue-300',
    text: 'text-blue-400',
    yard: 'bg-blue-950/70 border-blue-500/40',
    label: 'Cobalt',
  },
};

const STAR_COORDS = new Set(['2,6', '6,12', '12,8', '8,2']);

function getCellClass(r: number, c: number): string {
  // Home yards occupy 0..5 / 9..14 corners (rendered separately as clean blocks)
  if ((r < 6 && c < 6) || (r < 6 && c > 8) || (r > 8 && c < 6) || (r > 8 && c > 8)) {
    return 'bg-transparent';
  }
  if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
    return 'bg-transparent';
  }
  // Start cells & home stretches
  if ((r === 6 && c === 1) || (r === 7 && c >= 1 && c <= 5)) {
    return 'bg-rose-600/80 border-rose-400/40';
  }
  if ((r === 1 && c === 8) || (c === 7 && r >= 1 && r <= 5)) {
    return 'bg-emerald-600/80 border-emerald-400/40';
  }
  if ((r === 8 && c === 13) || (r === 7 && c >= 9 && c <= 13)) {
    return 'bg-amber-500/80 border-amber-300/40';
  }
  if ((r === 13 && c === 6) || (c === 7 && r >= 9 && r <= 13)) {
    return 'bg-blue-600/80 border-blue-400/40';
  }
  return 'bg-[#F5F0E6] border-[#D6CFC2]';
}

const DiceFace: React.FC<{ value: number | null; rolling: boolean }> = ({ value, rolling }) => {
  const pips: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  const active = value ? pips[value] || [] : [4];

  return (
    <div
      className={`w-14 h-14 rounded-2xl bg-[#FAF7F0] border-2 border-amber-500/60 shadow-lg grid grid-cols-3 grid-rows-3 gap-1 p-2.5 ${
        rolling ? 'animate-dice' : ''
      }`}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          className={`rounded-full ${
            active.includes(i) ? 'bg-slate-900' : 'bg-transparent'
          }`}
        />
      ))}
    </div>
  );
};

export const LudoClubView: React.FC<LudoClubViewProps> = ({
  profile,
  openRooms,
  sendWs,
  wsEmitter,
  onBalanceChange,
  onOpenCoins,
}) => {
  const [room, setRoom] = useState<LudoRoom | null>(null);
  const [maxPlayers, setMaxPlayers] = useState<2 | 4>(4);
  const [entryCoins, setEntryCoins] = useState<number>(0);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isRollingAnim, setIsRollingAnim] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const paidEntryRoomsRef = useRef<Set<string>>(new Set());
  const rewardedRoomsRef = useRef<Set<string>>(new Set());
  const profileCoinsRef = useRef(profile.coins);
  const profileEarnedRef = useRef(profile.totalEarnedCoins);
  profileCoinsRef.current = profile.coins;
  profileEarnedRef.current = profile.totalEarnedCoins;

  useEffect(() => {
    const onWsMessage = async (ev: Event) => {
      const msg = (ev as CustomEvent).detail;
      if (!msg) return;

      if (msg.type === 'ludo:error') {
        setError(msg.message || 'Could not join Ludo room.');
      }

      if (msg.type === 'ludo:state' && msg.room) {
        const nextRoom = msg.room as LudoRoom;
        setRoom((prev) => {
          if (prev && nextRoom.lastEvent !== prev.lastEvent) {
            if (nextRoom.lastEvent.includes('captured')) {
              soundFx.tokenCapture();
            } else if (nextRoom.diceValue !== null && prev.diceValue === null) {
              soundFx.diceRoll();
            } else {
              soundFx.tokenStep();
            }
          }
          return nextRoom;
        });
        setIsRollingAnim(false);
        setError(null);

        if (
          nextRoom.status === 'finished' &&
          nextRoom.winnerId &&
          !rewardedRoomsRef.current.has(nextRoom.roomCode)
        ) {
          rewardedRoomsRef.current.add(nextRoom.roomCode);
          if (nextRoom.winnerId === profile.uid) {
            soundFx.victory();
            confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 } });
            if (nextRoom.prizeCoins > 0) {
              const newBal = await recordCoinChange({
                uid: profile.uid,
                currentCoins: profileCoinsRef.current,
                currentEarned: profileEarnedRef.current,
                delta: nextRoom.prizeCoins,
                type: 'ludo_win',
                description: `Won Ludo Room ${nextRoom.roomCode}`,
              });
              onBalanceChange(newBal);
            }
            await updateOnlineAndRate(profile.uid, { winsCount: 1 });
          }
          if (nextRoom.hostId === profile.uid) {
            await saveLudoMatchResult({
              roomCode: nextRoom.roomCode,
              hostId: nextRoom.hostId,
              hostName: nextRoom.hostName,
              playersCount: nextRoom.players.length,
              entryCoins: nextRoom.entryCoins,
              prizeCoins: nextRoom.prizeCoins,
              winnerName: nextRoom.winnerName || 'Winner',
            });
          }
        }
      }
    };

    wsEmitter.addEventListener('ws-message', onWsMessage);
    return () => wsEmitter.removeEventListener('ws-message', onWsMessage);
  }, [profile.uid, onBalanceChange, wsEmitter]);

  const handleCreateRoom = async () => {
    setError(null);
    if (entryCoins > 0 && profile.coins < entryCoins) {
      onOpenCoins();
      return;
    }
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    if (entryCoins > 0 && !paidEntryRoomsRef.current.has(roomCode)) {
      paidEntryRoomsRef.current.add(roomCode);
      const newBal = await recordCoinChange({
        uid: profile.uid,
        currentCoins: profile.coins,
        currentEarned: profile.totalEarnedCoins,
        delta: -entryCoins,
        type: 'ludo_entry',
        description: `Entered Ludo Room ${roomCode}`,
      });
      onBalanceChange(newBal);
    }
    sendWs({
      type: 'ludo:create',
      roomCode,
      maxPlayers,
      entryCoins,
    });
  };

  const handleJoinRoom = async (code: string, feeCoins = 0) => {
    setError(null);
    const clean = code.trim().toUpperCase();
    if (!clean) return;
    if (feeCoins > 0 && profile.coins < feeCoins) {
      onOpenCoins();
      return;
    }
    if (feeCoins > 0 && !paidEntryRoomsRef.current.has(clean)) {
      paidEntryRoomsRef.current.add(clean);
      const newBal = await recordCoinChange({
        uid: profile.uid,
        currentCoins: profile.coins,
        currentEarned: profile.totalEarnedCoins,
        delta: -feeCoins,
        type: 'ludo_entry',
        description: `Joined Ludo Room ${clean}`,
      });
      onBalanceChange(newBal);
    }
    sendWs({ type: 'ludo:join', roomCode: clean });
  };

  const handleRoll = () => {
    if (!room || room.status !== 'playing' || room.phase !== 'roll') return;
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== profile.uid) return;
    setIsRollingAnim(true);
    soundFx.diceRoll();
    sendWs({ type: 'ludo:roll', roomCode: room.roomCode });
  };

  const handleMoveToken = (tokenIndex: number) => {
    if (!room || room.status !== 'playing' || room.phase !== 'move') return;
    const currentPlayer = room.players[room.turnIndex];
    if (!currentPlayer || currentPlayer.id !== profile.uid) return;
    sendWs({ type: 'ludo:move', roomCode: room.roomCode, tokenIndex });
  };

  const handleCopyRoomCode = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.roomCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const currentPlayer = room ? room.players[room.turnIndex] : null;
  const isMyTurn = !!room && room.status === 'playing' && currentPlayer?.id === profile.uid;
  const legalTokenIndices = useMemo(() => {
    if (!room || !isMyTurn || room.phase !== 'move' || room.diceValue === null || !currentPlayer) {
      return new Set<number>();
    }
    return new Set(getLegalTokenIndices(currentPlayer, room.diceValue));
  }, [room, isMyTurn, currentPlayer]);

  // Compute all tokens with micro-offset when overlapping
  const renderedTokens = useMemo(() => {
    if (!room) return [];
    const coordCount = new Map<string, number>();
    const list: {
      key: string;
      playerId: string;
      color: LudoColor;
      tokenIndex: number;
      row: number;
      col: number;
      offsetX: number;
      offsetY: number;
      canMove: boolean;
    }[] = [];

    for (const player of room.players) {
      player.tokens.forEach((progress, idx) => {
        const [r, c] = getTokenGridCoord(player.color, progress, idx);
        const keyStr = `${r.toFixed(1)},${c.toFixed(1)}`;
        const count = coordCount.get(keyStr) || 0;
        coordCount.set(keyStr, count + 1);
        const angle = (count * Math.PI) / 2;
        const spread = count === 0 ? 0 : 6;
        const canMove =
          isMyTurn &&
          player.id === profile.uid &&
          room.phase === 'move' &&
          legalTokenIndices.has(idx);

        list.push({
          key: `${player.id}_${idx}`,
          playerId: player.id,
          color: player.color,
          tokenIndex: idx,
          row: r,
          col: c,
          offsetX: Math.cos(angle) * spread,
          offsetY: Math.sin(angle) * spread,
          canMove,
        });
      });
    }
    return list;
  }, [room, isMyTurn, profile.uid, legalTokenIndices]);

  if (!room) {
    return (
      <div className="space-y-8">
        <div className="relative rounded-3xl overflow-hidden bg-[#131822] border border-white/10">
          <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-6 p-6 md:p-8 flex flex-col justify-between space-y-6">
              <div className="space-y-3">
                <div className="text-xs font-medium text-amber-400">
                  Real-Time Multiplayer · 2 &amp; 4 Players
                </div>
                <h1 className="font-display text-2xl md:text-4xl font-bold text-white leading-tight">
                  RangLive Ludo Club
                </h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Create a private Ludo table with your friends using a 6-character code, or start an instant match filled with smart opponents and win coin pools.
                </p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Table Size
                    </label>
                    <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#0B0E14] border border-white/10">
                      <button
                        type="button"
                        onClick={() => setMaxPlayers(2)}
                        className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                          maxPlayers === 2
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        2 Players
                      </button>
                      <button
                        type="button"
                        onClick={() => setMaxPlayers(4)}
                        className={`py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                          maxPlayers === 4
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        4 Players
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1.5">
                      Coin Entry Pool
                    </label>
                    <select
                      value={entryCoins}
                      onChange={(e) => setEntryCoins(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2.5 text-xs font-mono text-white focus:border-amber-500 focus:outline-none"
                    >
                      <option value={0}>Free Practice</option>
                      <option value={25}>25 Coins (Win {25 * maxPlayers})</option>
                      <option value={50}>50 Coins (Win {50 * maxPlayers})</option>
                      <option value={100}>100 Coins (Win {100 * maxPlayers})</option>
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleCreateRoom}
                  className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Create Ludo Table
                </button>
              </div>
            </div>

            <div className="lg:col-span-6 relative min-h-[240px] bg-[#0B0E14]">
              <img
                src={GENERATED_IMAGES.ludoBanner}
                alt="Handcrafted wooden Indian Ludo board with colored tokens and dice"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-[#131822] via-transparent to-transparent hidden lg:block" />
            </div>
          </div>
        </div>

        {/* Join by Code & Open Rooms */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 rounded-2xl bg-[#131822] border border-white/10 p-6 space-y-4">
            <h2 className="font-display text-lg font-semibold text-white">Join Room by Code</h2>
            <p className="text-xs text-slate-400">
              Got a 6-character code from a friend? Enter it below to take a seat.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={10}
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="e.g. X7K9P2"
                className="flex-1 rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-2.5 text-sm font-mono text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
              />
              <button
                onClick={() => handleJoinRoom(joinCodeInput)}
                className="px-4 py-2.5 rounded-xl bg-white text-slate-950 hover:bg-slate-200 text-xs font-semibold cursor-pointer"
              >
                Join Seat
              </button>
            </div>
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>

          <div className="lg:col-span-7 rounded-2xl bg-[#131822] border border-white/10 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-white">Open Ludo Tables</h2>
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {openRooms.length} active
              </span>
            </div>

            {openRooms.length > 0 ? (
              <div className="divide-y divide-white/5">
                {openRooms.map((r) => (
                  <div
                    key={r.roomCode}
                    className="py-3 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">
                        {r.hostName}'s Table
                      </div>
                      <div className="text-xs text-slate-400 font-mono tabular-nums">
                        {r.roomCode} · {r.playerCount}/{r.maxPlayers} players ·{' '}
                        {r.entryCoins === 0 ? 'Free' : `${r.entryCoins} coins`}
                      </div>
                    </div>
                    <button
                      onClick={() => handleJoinRoom(r.roomCode, r.entryCoins)}
                      disabled={r.status !== 'waiting'}
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold cursor-pointer"
                    >
                      {r.status === 'waiting' ? 'Join' : 'In Game'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-4">
                No public tables waiting right now. Create a table above and tap "Start with Smart Bots" or invite a friend!
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* 15x15 Interactive Ludo Board */}
      <div className="lg:col-span-7">
        <div className="aspect-square w-full max-w-[560px] mx-auto relative rounded-2xl overflow-hidden border-2 border-amber-500/35 bg-[#1C1917] shadow-2xl select-none">
          {/* 15x15 Grid Cells */}
          <div className="grid grid-cols-15 grid-rows-15 w-full h-full">
            {Array.from({ length: 225 }).map((_, idx) => {
              const r = Math.floor(idx / 15);
              const c = idx % 15;
              const isStar = STAR_COORDS.has(`${r},${c}`);
              return (
                <div
                  key={idx}
                  className={`border-[0.5px] flex items-center justify-center ${getCellClass(r, c)}`}
                >
                  {isStar && <Star className="w-3 h-3 text-amber-600/80 fill-amber-500/30" />}
                </div>
              );
            })}
          </div>

          {/* 4 Corner Yards */}
          <div className="absolute top-0 left-0 w-[40%] h-[40%] p-2.5 bg-rose-700 border-r border-b border-black/30">
            <div className="w-full h-full rounded-xl bg-[#FAF7F0] grid grid-cols-2 grid-rows-2 gap-2.5 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-full bg-rose-600/20 border-2 border-rose-600/40" />
              ))}
            </div>
          </div>

          <div className="absolute top-0 right-0 w-[40%] h-[40%] p-2.5 bg-emerald-700 border-l border-b border-black/30">
            <div className="w-full h-full rounded-xl bg-[#FAF7F0] grid grid-cols-2 grid-rows-2 gap-2.5 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-full bg-emerald-600/20 border-2 border-emerald-600/40" />
              ))}
            </div>
          </div>

          <div className="absolute bottom-0 right-0 w-[40%] h-[40%] p-2.5 bg-amber-500 border-l border-t border-black/30">
            <div className="w-full h-full rounded-xl bg-[#FAF7F0] grid grid-cols-2 grid-rows-2 gap-2.5 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-full bg-amber-500/20 border-2 border-amber-500/50" />
              ))}
            </div>
          </div>

          <div className="absolute bottom-0 left-0 w-[40%] h-[40%] p-2.5 bg-blue-700 border-r border-t border-black/30">
            <div className="w-full h-full rounded-xl bg-[#FAF7F0] grid grid-cols-2 grid-rows-2 gap-2.5 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-full bg-blue-600/20 border-2 border-blue-600/40" />
              ))}
            </div>
          </div>

          {/* Center 3x3 Home Goal Triangles */}
          <svg
            viewBox="0 0 100 100"
            className="absolute top-[40%] left-[40%] w-[20%] h-[20%] pointer-events-none"
          >
            <polygon points="0,0 50,50 0,100" fill="#E11D48" />
            <polygon points="0,0 100,0 50,50" fill="#10B981" />
            <polygon points="100,0 100,100 50,50" fill="#F59E0B" />
            <polygon points="0,100 100,100 50,50" fill="#2563EB" />
            <circle cx="50" cy="50" r="14" fill="#FAF7F0" />
          </svg>

          {/* Animated Tokens Layer */}
          {renderedTokens.map((tok) => {
            const style = COLOR_STYLES[tok.color];
            return (
              <button
                key={tok.key}
                type="button"
                disabled={!tok.canMove}
                onClick={() => tok.canMove && handleMoveToken(tok.tokenIndex)}
                style={{
                  top: `${((tok.row + 0.5) / 15) * 100}%`,
                  left: `${((tok.col + 0.5) / 15) * 100}%`,
                  transform: `translate(calc(-50% + ${tok.offsetX}px), calc(-50% + ${tok.offsetY}px))`,
                }}
                aria-label={`${tok.color} token ${tok.tokenIndex + 1}`}
                className={`absolute z-10 w-[5.5%] h-[5.5%] min-w-[20px] min-h-[20px] rounded-full border-2 shadow-md transition-all duration-200 flex items-center justify-center ${
                  style.bg
                } ${style.border} ${
                  tok.canMove
                    ? 'ring-4 ring-white cursor-pointer scale-125 z-20'
                    : 'cursor-default'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-white/80" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Room HUD, Dice & Players Panel */}
      <div className="lg:col-span-5 space-y-5">
        <div className="rounded-2xl bg-[#131822] border border-white/10 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">Room Code</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="font-mono text-xl font-bold text-white tracking-wider">
                  {room.roomCode}
                </span>
                <button
                  onClick={handleCopyRoomCode}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 cursor-pointer"
                  aria-label="Copy room code"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copiedCode && <span className="text-xs text-emerald-400">Copied</span>}
              </div>
            </div>

            <div className="text-right">
              <div className="text-xs text-slate-400">Prize Pool</div>
              <div className="font-mono text-lg font-bold text-amber-400 tabular-nums">
                {room.prizeCoins === 0 ? 'Practice' : `${room.prizeCoins} coins`}
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#0B0E14] border border-white/5 px-3.5 py-2.5 text-xs text-slate-300">
            {room.lastEvent}
          </div>

          {/* Waiting Room Controls */}
          {room.status === 'waiting' && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Users className="w-4 h-4 text-amber-400" />
                <span>
                  {room.players.length} of {room.maxPlayers} players seated
                </span>
              </div>
              {room.hostId === profile.uid && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    onClick={() => sendWs({ type: 'ludo:fill_bots', roomCode: room.roomCode })}
                    className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Fill Bots &amp; Start
                  </button>
                  <button
                    onClick={() => sendWs({ type: 'ludo:start', roomCode: room.roomCode })}
                    disabled={room.players.length < 2}
                    className="py-2.5 px-3 rounded-xl border border-white/15 hover:bg-white/5 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                  >
                    Start With Friends
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Active Dice Controls */}
          {room.status === 'playing' && (
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/10">
              <div className="flex items-center gap-3.5">
                <DiceFace value={room.diceValue} rolling={isRollingAnim} />
                <div>
                  <div className="text-xs text-slate-400">Current Turn</div>
                  <div className="font-display text-base font-semibold text-white">
                    {currentPlayer?.name}
                  </div>
                  <div className="text-xs text-amber-400">
                    {isMyTurn
                      ? room.phase === 'roll'
                        ? 'Tap Roll Dice'
                        : 'Select a highlighted token'
                      : 'Waiting for opponent...'}
                  </div>
                </div>
              </div>

              <button
                onClick={handleRoll}
                disabled={!isMyTurn || room.phase !== 'roll'}
                className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer shrink-0"
              >
                <Dice5 className="w-4 h-4" />
                Roll Dice
              </button>
            </div>
          )}

          {/* Winner Banner */}
          {room.status === 'finished' && (
            <div className="rounded-xl bg-amber-500/15 border border-amber-500/40 p-4 text-center space-y-3">
              <Crown className="w-7 h-7 text-amber-400 mx-auto" />
              <div>
                <div className="font-display text-lg font-bold text-white">
                  {room.winnerName} Won!
                </div>
                {room.prizeCoins > 0 && (
                  <p className="text-xs text-amber-300 mt-0.5">
                    Prize {room.prizeCoins} coins awarded
                  </p>
                )}
              </div>
              <button
                onClick={() => setRoom(null)}
                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer"
              >
                Play Again
              </button>
            </div>
          )}
        </div>

        {/* Players Roster */}
        <div className="rounded-2xl bg-[#131822] border border-white/10 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-white">Players</h3>
            <button
              onClick={() => {
                sendWs({ type: 'ludo:leave', roomCode: room.roomCode });
                setRoom(null);
              }}
              className="text-xs text-slate-400 hover:text-rose-400 cursor-pointer"
            >
              Leave Table
            </button>
          </div>
          <div className="space-y-2.5">
            {room.players.map((p, idx) => {
              const st = COLOR_STYLES[p.color];
              const activeTurn = room.status === 'playing' && room.turnIndex === idx;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 border ${
                    activeTurn
                      ? 'bg-[#0B0E14] border-amber-500/50'
                      : 'bg-[#0B0E14]/50 border-white/5'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-3.5 h-3.5 rounded-full ${st.bg} shrink-0`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {p.name} {p.id === profile.uid ? '(You)' : ''}
                      </div>
                      <div className="text-xs text-slate-400">
                        {p.city} · {st.label}
                      </div>
                    </div>
                  </div>
                  <div className="font-mono text-xs text-slate-300 tabular-nums shrink-0">
                    {p.finishedCount}/4 Home
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
