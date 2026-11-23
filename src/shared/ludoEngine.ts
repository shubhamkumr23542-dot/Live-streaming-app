export type LudoColor = 'red' | 'green' | 'yellow' | 'blue';

export interface LudoPlayer {
  id: string;
  name: string;
  city: string;
  color: LudoColor;
  isBot: boolean;
  tokens: number[]; // -1 = yard, 0..50 = outer track progress, 51..55 = home stretch, 56 = finished
  finishedCount: number;
}

export interface LudoRoom {
  roomCode: string;
  hostId: string;
  hostName: string;
  maxPlayers: 2 | 4;
  entryCoins: number;
  prizeCoins: number;
  status: 'waiting' | 'playing' | 'finished';
  players: LudoPlayer[];
  turnIndex: number;
  diceValue: number | null;
  phase: 'roll' | 'move';
  consecutiveSixes: number;
  winnerId: string | null;
  winnerName: string | null;
  lastEvent: string;
  updatedAt: number;
}

export const COLOR_ORDER: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

export const START_OFFSETS: Record<LudoColor, number> = {
  red: 0,
  green: 13,
  yellow: 26,
  blue: 39,
};

export const SAFE_OUTER_INDICES = new Set<number>([0, 8, 13, 21, 26, 34, 39, 47]);

// 52 outer track coordinates on 15x15 grid [row, col]
export const OUTER_TRACK_COORDS: [number, number][] = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
  [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
  [0, 7], [0, 8],
  [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
  [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
  [7, 14], [8, 14],
  [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
  [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6],
  [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  [7, 0], [6, 0],
];

export const HOME_STRETCH_COORDS: Record<LudoColor, [number, number][]> = {
  red: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
  green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
  yellow: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
};

export const YARD_COORDS: Record<LudoColor, [number, number][]> = {
  red: [[1.7, 1.7], [1.7, 3.3], [3.3, 1.7], [3.3, 3.3]],
  green: [[1.7, 10.7], [1.7, 12.3], [3.3, 10.7], [3.3, 12.3]],
  yellow: [[10.7, 10.7], [10.7, 12.3], [12.3, 10.7], [12.3, 12.3]],
  blue: [[10.7, 1.7], [10.7, 3.3], [12.3, 1.7], [12.3, 3.3]],
};

export const HOME_GOAL_COORDS: Record<LudoColor, [number, number]> = {
  red: [7, 6.2],
  green: [6.2, 7],
  yellow: [7, 7.8],
  blue: [7.8, 7],
};

export function getOuterIndex(color: LudoColor, progress: number): number | null {
  if (progress < 0 || progress > 50) return null;
  return (START_OFFSETS[color] + progress) % 52;
}

export function getTokenGridCoord(
  color: LudoColor,
  progress: number,
  tokenIdx: number
): [number, number] {
  if (progress === -1) {
    return YARD_COORDS[color][tokenIdx];
  }
  if (progress >= 0 && progress <= 50) {
    const outerIdx = (START_OFFSETS[color] + progress) % 52;
    return OUTER_TRACK_COORDS[outerIdx];
  }
  if (progress >= 51 && progress <= 55) {
    return HOME_STRETCH_COORDS[color][progress - 51];
  }
  return HOME_GOAL_COORDS[color];
}

export function getLegalTokenIndices(player: LudoPlayer, diceValue: number): number[] {
  const legal: number[] = [];
  for (let i = 0; i < player.tokens.length; i++) {
    const pos = player.tokens[i];
    if (pos === 56) continue;
    if (pos === -1) {
      if (diceValue === 6) legal.push(i);
    } else if (pos + diceValue <= 56) {
      legal.push(i);
    }
  }
  return legal;
}

export function applyLudoMove(
  room: LudoRoom,
  playerIndex: number,
  tokenIndex: number
): { capturedName: string | null; reachedHome: boolean; bonusTurn: boolean; won: boolean } {
  const player = room.players[playerIndex];
  const dice = room.diceValue ?? 0;
  const currentPos = player.tokens[tokenIndex];
  const nextPos = currentPos === -1 ? 0 : currentPos + dice;
  player.tokens[tokenIndex] = nextPos;

  let capturedName: string | null = null;
  const reachedHome = nextPos === 56;
  if (reachedHome) {
    player.finishedCount = player.tokens.filter((t) => t === 56).length;
  }

  // Check capture on shared outer track
  const targetOuter = getOuterIndex(player.color, nextPos);
  if (targetOuter !== null && !SAFE_OUTER_INDICES.has(targetOuter)) {
    for (let otherIdx = 0; otherIdx < room.players.length; otherIdx++) {
      if (otherIdx === playerIndex) continue;
      const opponent = room.players[otherIdx];
      for (let t = 0; t < opponent.tokens.length; t++) {
        const oppOuter = getOuterIndex(opponent.color, opponent.tokens[t]);
        if (oppOuter === targetOuter) {
          opponent.tokens[t] = -1;
          capturedName = opponent.name;
        }
      }
    }
  }

  const won = player.finishedCount === 4;
  if (won) {
    room.status = 'finished';
    room.winnerId = player.id;
    room.winnerName = player.name;
    room.lastEvent = `${player.name} won the Ludo match!`;
    room.updatedAt = Date.now();
    return { capturedName, reachedHome, bonusTurn: false, won: true };
  }

  const bonusTurn = dice === 6 || capturedName !== null || reachedHome;
  if (bonusTurn) {
    room.phase = 'roll';
    room.diceValue = null;
    if (capturedName) {
      room.lastEvent = `${player.name} captured ${capturedName}'s token! Bonus roll.`;
    } else if (reachedHome) {
      room.lastEvent = `${player.name}'s token reached home! Bonus roll.`;
    } else {
      room.lastEvent = `${player.name} rolled a 6 and gets a bonus roll.`;
    }
  } else {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    room.phase = 'roll';
    room.diceValue = null;
    room.consecutiveSixes = 0;
    room.lastEvent = `${room.players[room.turnIndex].name}'s turn to roll.`;
  }

  room.updatedAt = Date.now();
  return { capturedName, reachedHome, bonusTurn, won: false };
}

export function chooseSmartBotToken(room: LudoRoom, playerIndex: number): number | null {
  const player = room.players[playerIndex];
  const dice = room.diceValue;
  if (dice === null) return null;
  const legal = getLegalTokenIndices(player, dice);
  if (legal.length === 0) return null;

  let bestToken = legal[0];
  let bestScore = -999;

  for (const idx of legal) {
    const pos = player.tokens[idx];
    const nextPos = pos === -1 ? 0 : pos + dice;
    let score = 0;

    if (nextPos === 56) score += 200; // Finish token
    if (pos === -1 && dice === 6) score += 110; // Bring out of yard

    const nextOuter = getOuterIndex(player.color, nextPos);
    if (nextOuter !== null) {
      if (SAFE_OUTER_INDICES.has(nextOuter)) score += 60;
      else {
        // Check capture opportunity
        for (let o = 0; o < room.players.length; o++) {
          if (o === playerIndex) continue;
          const opp = room.players[o];
          for (const oppPos of opp.tokens) {
            if (getOuterIndex(opp.color, oppPos) === nextOuter) {
              score += 150;
            }
          }
        }
      }
    }

    if (nextPos >= 51 && nextPos < 56) score += 80; // Entering safe home stretch
    score += nextPos * 0.5; // Prefer advancing lead token

    if (score > bestScore) {
      bestScore = score;
      bestToken = idx;
    }
  }

  return bestToken;
}
