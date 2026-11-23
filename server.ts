import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import {
  COLOR_ORDER,
  applyLudoMove,
  chooseSmartBotToken,
  getLegalTokenIndices,
  type LudoPlayer,
  type LudoRoom,
} from './src/shared/ludoEngine.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

interface OnlineUser {
  userId: string;
  displayName: string;
  city: string;
  state: string;
  language: string;
  callRatePerMin: number;
  avatarColor: string;
  isLive: boolean;
  socket: WebSocket;
}

interface ActiveStream {
  streamId: string;
  hostId: string;
  hostName: string;
  hostCity: string;
  title: string;
  category: string;
  language: string;
  callRatePerMin: number;
  viewers: Set<string>;
  startedAt: number;
}

interface PendingOtp {
  code: string;
  expiresAt: number;
}

const onlineUsers = new Map<string, OnlineUser>();
const socketToUserId = new Map<WebSocket, string>();
const activeStreams = new Map<string, ActiveStream>();
const ludoRooms = new Map<string, LudoRoom>();
const otpStore = new Map<string, PendingOtp>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

const INDIAN_BOT_ROSTER = [
  { name: 'Aarav (Jaipur)', city: 'Jaipur' },
  { name: 'Priya (Mumbai)', city: 'Mumbai' },
  { name: 'Kabir (Bengaluru)', city: 'Bengaluru' },
  { name: 'Ananya (Delhi)', city: 'Delhi' },
];

function sendJson(ws: WebSocket | undefined, payload: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastPresence() {
  const usersList = Array.from(onlineUsers.values()).map((u) => ({
    userId: u.userId,
    displayName: u.displayName,
    city: u.city,
    state: u.state,
    language: u.language,
    callRatePerMin: u.callRatePerMin,
    avatarColor: u.avatarColor,
    isLive: u.isLive,
  }));

  const streamsList = Array.from(activeStreams.values()).map((s) => ({
    streamId: s.streamId,
    hostId: s.hostId,
    hostName: s.hostName,
    hostCity: s.hostCity,
    title: s.title,
    category: s.category,
    language: s.language,
    callRatePerMin: s.callRatePerMin,
    viewerCount: s.viewers.size,
    startedAt: s.startedAt,
  }));

  const openRooms = Array.from(ludoRooms.values())
    .filter((r) => r.status !== 'finished')
    .map((r) => ({
      roomCode: r.roomCode,
      hostName: r.hostName,
      maxPlayers: r.maxPlayers,
      playerCount: r.players.length,
      entryCoins: r.entryCoins,
      prizeCoins: r.prizeCoins,
      status: r.status,
    }));

  const payload = {
    type: 'presence:sync',
    users: usersList,
    streams: streamsList,
    ludoRooms: openRooms,
  };

  for (const user of onlineUsers.values()) {
    sendJson(user.socket, payload);
  }
}

function broadcastLudoRoom(room: LudoRoom) {
  const payload = { type: 'ludo:state', room };
  for (const player of room.players) {
    if (!player.isBot) {
      const user = onlineUsers.get(player.id);
      sendJson(user?.socket, payload);
    }
  }
}

function scheduleBotTurnIfNeeded(roomCode: string) {
  const existingTimer = botTimers.get(roomCode);
  if (existingTimer) {
    clearTimeout(existingTimer);
    botTimers.delete(roomCode);
  }

  const room = ludoRooms.get(roomCode);
  if (!room || room.status !== 'playing') return;

  const currentPlayer = room.players[room.turnIndex];
  if (!currentPlayer || !currentPlayer.isBot) return;

  const timer = setTimeout(() => {
    const latestRoom = ludoRooms.get(roomCode);
    if (!latestRoom || latestRoom.status !== 'playing') return;
    const bot = latestRoom.players[latestRoom.turnIndex];
    if (!bot || !bot.isBot) return;

    if (latestRoom.phase === 'roll') {
      const dice = Math.floor(Math.random() * 6) + 1;
      latestRoom.diceValue = dice;
      if (dice === 6) {
        latestRoom.consecutiveSixes += 1;
      } else {
        latestRoom.consecutiveSixes = 0;
      }

      if (latestRoom.consecutiveSixes >= 3) {
        latestRoom.lastEvent = `${bot.name} rolled three 6s in a row. Turn skipped.`;
        latestRoom.turnIndex = (latestRoom.turnIndex + 1) % latestRoom.players.length;
        latestRoom.diceValue = null;
        latestRoom.consecutiveSixes = 0;
        latestRoom.phase = 'roll';
        latestRoom.updatedAt = Date.now();
        broadcastLudoRoom(latestRoom);
        scheduleBotTurnIfNeeded(roomCode);
        return;
      }

      const legal = getLegalTokenIndices(bot, dice);
      if (legal.length === 0) {
        latestRoom.lastEvent = `${bot.name} rolled ${dice} with no legal moves.`;
        latestRoom.turnIndex = (latestRoom.turnIndex + 1) % latestRoom.players.length;
        latestRoom.diceValue = null;
        latestRoom.consecutiveSixes = 0;
        latestRoom.phase = 'roll';
        latestRoom.updatedAt = Date.now();
        broadcastLudoRoom(latestRoom);
        scheduleBotTurnIfNeeded(roomCode);
        return;
      }

      latestRoom.phase = 'move';
      latestRoom.lastEvent = `${bot.name} rolled ${dice}.`;
      broadcastLudoRoom(latestRoom);

      const moveTimer = setTimeout(() => {
        const roomForMove = ludoRooms.get(roomCode);
        if (!roomForMove || roomForMove.status !== 'playing') return;
        const chosenIdx = chooseSmartBotToken(roomForMove, roomForMove.turnIndex);
        if (chosenIdx !== null) {
          applyLudoMove(roomForMove, roomForMove.turnIndex, chosenIdx);
          broadcastLudoRoom(roomForMove);
          broadcastPresence();
          scheduleBotTurnIfNeeded(roomCode);
        }
      }, 650);
      botTimers.set(roomCode, moveTimer);
    }
  }, 700);

  botTimers.set(roomCode, timer);
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      onlineUsers: onlineUsers.size,
      activeStreams: activeStreams.size,
      activeLudoRooms: ludoRooms.size,
    });
  });

  app.post('/api/auth/send-otp', (req, res) => {
    const rawPhone = String(req.body?.phoneNumber || '').replace(/\D/g, '');
    const normalized = rawPhone.length === 10 ? `+91${rawPhone}` : `+${rawPhone}`;
    if (normalized.length < 12 || normalized.length > 14) {
      res.status(400).json({ error: 'Please enter a valid 10-digit Indian mobile number.' });
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpStore.set(normalized, { code, expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({
      ok: true,
      phoneNumber: normalized,
      verificationCode: code,
      expiresInSec: 300,
    });
  });

  app.post('/api/auth/verify-otp', (req, res) => {
    const rawPhone = String(req.body?.phoneNumber || '').replace(/\D/g, '');
    const normalized = rawPhone.length === 10 ? `+91${rawPhone}` : `+${rawPhone}`;
    const otp = String(req.body?.otp || '').trim();
    const record = otpStore.get(normalized);
    if (!record || record.expiresAt < Date.now() || record.code !== otp) {
      res.status(400).json({ error: 'Invalid or expired 6-digit OTP code.' });
      return;
    }
    otpStore.delete(normalized);
    res.json({ ok: true, phoneNumber: normalized, verified: true });
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const senderId = socketToUserId.get(ws);

        switch (msg.type) {
          case 'auth:register': {
            const {
              userId,
              displayName,
              city,
              state,
              language,
              callRatePerMin,
              avatarColor,
            } = msg;
            if (!userId || !displayName) return;
            socketToUserId.set(ws, userId);
            onlineUsers.set(userId, {
              userId,
              displayName,
              city: city || 'Mumbai',
              state: state || 'Maharashtra',
              language: language || 'Hindi',
              callRatePerMin: Number(callRatePerMin ?? 20),
              avatarColor: avatarColor || '#F59E0B',
              isLive: false,
              socket: ws,
            });
            broadcastPresence();
            break;
          }

          case 'stream:start': {
            if (!senderId) return;
            const user = onlineUsers.get(senderId);
            if (!user) return;
            const streamId = String(msg.streamId || `stream_${senderId}`);
            user.isLive = true;
            activeStreams.set(streamId, {
              streamId,
              hostId: senderId,
              hostName: user.displayName,
              hostCity: user.city,
              title: String(msg.title || `${user.displayName}'s Live Room`).slice(0, 100),
              category: String(msg.category || 'Talk & Music'),
              language: user.language,
              callRatePerMin: user.callRatePerMin,
              viewers: new Set<string>(),
              startedAt: Date.now(),
            });
            broadcastPresence();
            break;
          }

          case 'stream:stop': {
            if (!senderId) return;
            const user = onlineUsers.get(senderId);
            if (user) user.isLive = false;
            const streamId = String(msg.streamId || '');
            const stream = activeStreams.get(streamId);
            if (stream && stream.hostId === senderId) {
              for (const viewerId of stream.viewers) {
                sendJson(onlineUsers.get(viewerId)?.socket, {
                  type: 'stream:ended',
                  streamId,
                });
              }
              activeStreams.delete(streamId);
            }
            broadcastPresence();
            break;
          }

          case 'stream:join': {
            if (!senderId) return;
            const streamId = String(msg.streamId || '');
            const stream = activeStreams.get(streamId);
            if (!stream) return;
            stream.viewers.add(senderId);
            sendJson(onlineUsers.get(stream.hostId)?.socket, {
              type: 'stream:viewer_joined',
              streamId,
              viewerId: senderId,
              viewerName: onlineUsers.get(senderId)?.displayName || 'Viewer',
              viewerCount: stream.viewers.size,
            });
            broadcastPresence();
            break;
          }

          case 'stream:leave': {
            if (!senderId) return;
            const streamId = String(msg.streamId || '');
            const stream = activeStreams.get(streamId);
            if (!stream) return;
            stream.viewers.delete(senderId);
            sendJson(onlineUsers.get(stream.hostId)?.socket, {
              type: 'stream:viewer_left',
              streamId,
              viewerId: senderId,
              viewerCount: stream.viewers.size,
            });
            broadcastPresence();
            break;
          }

          case 'stream:chat': {
            if (!senderId) return;
            const streamId = String(msg.streamId || '');
            const stream = activeStreams.get(streamId);
            if (!stream) return;
            const payload = {
              type: 'stream:chat',
              streamId,
              senderId,
              senderName: onlineUsers.get(senderId)?.displayName || 'Guest',
              text: String(msg.text || '').slice(0, 300),
              giftName: String(msg.giftName || ''),
              giftCoins: Number(msg.giftCoins || 0),
              createdAt: Date.now(),
            };
            sendJson(onlineUsers.get(stream.hostId)?.socket, payload);
            for (const viewerId of stream.viewers) {
              sendJson(onlineUsers.get(viewerId)?.socket, payload);
            }
            break;
          }

          case 'stream:signal': {
            if (!senderId) return;
            const target = onlineUsers.get(String(msg.targetId || ''));
            sendJson(target?.socket, {
              type: 'stream:signal',
              streamId: msg.streamId,
              fromId: senderId,
              signal: msg.signal,
            });
            break;
          }

          case 'call:invite': {
            if (!senderId) return;
            const caller = onlineUsers.get(senderId);
            const callee = onlineUsers.get(String(msg.calleeId || ''));
            if (!caller || !callee) {
              sendJson(ws, { type: 'call:unavailable', calleeId: msg.calleeId });
              return;
            }
            sendJson(callee.socket, {
              type: 'call:incoming',
              callId: msg.callId,
              callerId: caller.userId,
              callerName: caller.displayName,
              callerCity: caller.city,
              callType: msg.callType === 'audio' ? 'audio' : 'video',
              ratePerMin: callee.callRatePerMin,
            });
            break;
          }

          case 'call:accept':
          case 'call:reject':
          case 'call:end': {
            if (!senderId) return;
            const peer = onlineUsers.get(String(msg.peerId || ''));
            sendJson(peer?.socket, {
              type: msg.type,
              callId: msg.callId,
              fromId: senderId,
            });
            break;
          }

          case 'call:signal': {
            if (!senderId) return;
            const peer = onlineUsers.get(String(msg.peerId || ''));
            sendJson(peer?.socket, {
              type: 'call:signal',
              callId: msg.callId,
              fromId: senderId,
              signal: msg.signal,
            });
            break;
          }

          case 'ludo:create': {
            if (!senderId) return;
            const host = onlineUsers.get(senderId);
            if (!host) return;
            const roomCode = String(msg.roomCode || Math.random().toString(36).substring(2, 8)).toUpperCase();
            const maxPlayers: 2 | 4 = msg.maxPlayers === 2 ? 2 : 4;
            const entryCoins = Math.max(0, Number(msg.entryCoins || 0));
            const firstColor = COLOR_ORDER[0];
            const room: LudoRoom = {
              roomCode,
              hostId: host.userId,
              hostName: host.displayName,
              maxPlayers,
              entryCoins,
              prizeCoins: entryCoins * maxPlayers,
              status: 'waiting',
              players: [
                {
                  id: host.userId,
                  name: host.displayName,
                  city: host.city,
                  color: firstColor,
                  isBot: false,
                  tokens: [-1, -1, -1, -1],
                  finishedCount: 0,
                },
              ],
              turnIndex: 0,
              diceValue: null,
              phase: 'roll',
              consecutiveSixes: 0,
              winnerId: null,
              winnerName: null,
              lastEvent: `${host.displayName} created room ${roomCode}.`,
              updatedAt: Date.now(),
            };
            ludoRooms.set(roomCode, room);
            broadcastLudoRoom(room);
            broadcastPresence();
            break;
          }

          case 'ludo:join': {
            if (!senderId) return;
            const user = onlineUsers.get(senderId);
            const roomCode = String(msg.roomCode || '').toUpperCase().trim();
            const room = ludoRooms.get(roomCode);
            if (!user || !room) {
              sendJson(ws, { type: 'ludo:error', message: 'Ludo room code not found.' });
              return;
            }
            const already = room.players.find((p) => p.id === user.userId);
            if (already) {
              sendJson(ws, { type: 'ludo:state', room });
              return;
            }
            if (room.status !== 'waiting' || room.players.length >= room.maxPlayers) {
              sendJson(ws, { type: 'ludo:error', message: 'Ludo room is already full or started.' });
              return;
            }
            const seatIdx = room.players.length;
            const color = room.maxPlayers === 2 && seatIdx === 1 ? 'yellow' : COLOR_ORDER[seatIdx];
            room.players.push({
              id: user.userId,
              name: user.displayName,
              city: user.city,
              color,
              isBot: false,
              tokens: [-1, -1, -1, -1],
              finishedCount: 0,
            });
            room.lastEvent = `${user.displayName} joined from ${user.city}.`;
            room.updatedAt = Date.now();
            broadcastLudoRoom(room);
            broadcastPresence();
            break;
          }

          case 'ludo:fill_bots': {
            if (!senderId) return;
            const room = ludoRooms.get(String(msg.roomCode || '').toUpperCase());
            if (!room || room.hostId !== senderId || room.status !== 'waiting') return;
            while (room.players.length < room.maxPlayers) {
              const seatIdx = room.players.length;
              const color = room.maxPlayers === 2 && seatIdx === 1 ? 'yellow' : COLOR_ORDER[seatIdx];
              const botInfo = INDIAN_BOT_ROSTER[seatIdx % INDIAN_BOT_ROSTER.length];
              room.players.push({
                id: `bot_${room.roomCode}_${seatIdx}`,
                name: botInfo.name,
                city: botInfo.city,
                color,
                isBot: true,
                tokens: [-1, -1, -1, -1],
                finishedCount: 0,
              });
            }
            room.status = 'playing';
            room.lastEvent = `Match started! ${room.players[0].name}'s turn to roll.`;
            room.updatedAt = Date.now();
            broadcastLudoRoom(room);
            broadcastPresence();
            scheduleBotTurnIfNeeded(room.roomCode);
            break;
          }

          case 'ludo:start': {
            if (!senderId) return;
            const room = ludoRooms.get(String(msg.roomCode || '').toUpperCase());
            if (!room || room.hostId !== senderId || room.players.length < 2) return;
            room.status = 'playing';
            room.lastEvent = `Match started! ${room.players[0].name}'s turn to roll.`;
            room.updatedAt = Date.now();
            broadcastLudoRoom(room);
            broadcastPresence();
            scheduleBotTurnIfNeeded(room.roomCode);
            break;
          }

          case 'ludo:roll': {
            if (!senderId) return;
            const room = ludoRooms.get(String(msg.roomCode || '').toUpperCase());
            if (!room || room.status !== 'playing' || room.phase !== 'roll') return;
            const player = room.players[room.turnIndex];
            if (!player || player.id !== senderId) return;

            const dice = Math.floor(Math.random() * 6) + 1;
            room.diceValue = dice;
            if (dice === 6) {
              room.consecutiveSixes += 1;
            } else {
              room.consecutiveSixes = 0;
            }

            if (room.consecutiveSixes >= 3) {
              room.lastEvent = `${player.name} rolled three 6s in a row! Turn passed.`;
              room.turnIndex = (room.turnIndex + 1) % room.players.length;
              room.diceValue = null;
              room.consecutiveSixes = 0;
              room.phase = 'roll';
              room.updatedAt = Date.now();
              broadcastLudoRoom(room);
              scheduleBotTurnIfNeeded(room.roomCode);
              return;
            }

            const legal = getLegalTokenIndices(player, dice);
            if (legal.length === 0) {
              room.lastEvent = `${player.name} rolled ${dice}. No legal moves.`;
              room.turnIndex = (room.turnIndex + 1) % room.players.length;
              room.diceValue = null;
              room.consecutiveSixes = 0;
              room.phase = 'roll';
              room.updatedAt = Date.now();
              broadcastLudoRoom(room);
              scheduleBotTurnIfNeeded(room.roomCode);
              return;
            }

            if (legal.length === 1) {
              // Auto-move when only one token can legally move for snappy UX
              room.phase = 'move';
              room.lastEvent = `${player.name} rolled ${dice}.`;
              applyLudoMove(room, room.turnIndex, legal[0]);
              broadcastLudoRoom(room);
              broadcastPresence();
              scheduleBotTurnIfNeeded(room.roomCode);
              return;
            }

            room.phase = 'move';
            room.lastEvent = `${player.name} rolled ${dice} — pick a highlighted token.`;
            room.updatedAt = Date.now();
            broadcastLudoRoom(room);
            break;
          }

          case 'ludo:move': {
            if (!senderId) return;
            const room = ludoRooms.get(String(msg.roomCode || '').toUpperCase());
            if (!room || room.status !== 'playing' || room.phase !== 'move') return;
            const player = room.players[room.turnIndex];
            if (!player || player.id !== senderId) return;
            const tokenIdx = Number(msg.tokenIndex);
            const legal = getLegalTokenIndices(player, room.diceValue ?? 0);
            if (!legal.includes(tokenIdx)) return;

            applyLudoMove(room, room.turnIndex, tokenIdx);
            broadcastLudoRoom(room);
            broadcastPresence();
            scheduleBotTurnIfNeeded(room.roomCode);
            break;
          }

          case 'ludo:leave': {
            if (!senderId) return;
            const roomCode = String(msg.roomCode || '').toUpperCase();
            const room = ludoRooms.get(roomCode);
            if (!room) return;
            if (room.hostId === senderId && room.status === 'waiting') {
              ludoRooms.delete(roomCode);
            }
            broadcastPresence();
            break;
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      const userId = socketToUserId.get(ws);
      socketToUserId.delete(ws);
      if (userId) {
        const current = onlineUsers.get(userId);
        if (current?.socket === ws) {
          onlineUsers.delete(userId);
          for (const [streamId, stream] of activeStreams.entries()) {
            if (stream.hostId === userId) {
              for (const viewerId of stream.viewers) {
                sendJson(onlineUsers.get(viewerId)?.socket, { type: 'stream:ended', streamId });
              }
              activeStreams.delete(streamId);
            } else if (stream.viewers.has(userId)) {
              stream.viewers.delete(userId);
            }
          }
          broadcastPresence();
        }
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RangLive server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start RangLive server:', err);
  process.exit(1);
});
