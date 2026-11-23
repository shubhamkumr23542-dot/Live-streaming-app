export type AppTab = 'live' | 'calls' | 'ludo' | 'coins' | 'refer';

export interface UserProfile {
  uid: string;
  displayName: string;
  phoneNumber: string;
  phoneVerified: boolean;
  email?: string;
  city: string;
  state: string;
  language: string;
  coins: number;
  referralCode: string;
  referredBy: string;
  referralCount: number;
  totalEarnedCoins: number;
}

export interface PublicProfile {
  uid: string;
  displayName: string;
  city: string;
  state: string;
  language: string;
  referralCode: string;
  isOnline: boolean;
  isLive: boolean;
  callRatePerMin: number;
  winsCount: number;
  avatarColor: string;
}

export interface OnlinePresenceUser {
  userId: string;
  displayName: string;
  city: string;
  state: string;
  language: string;
  callRatePerMin: number;
  avatarColor: string;
  isLive: boolean;
}

export interface LiveStreamSummary {
  streamId: string;
  hostId: string;
  hostName: string;
  hostCity: string;
  title: string;
  category: string;
  language: string;
  callRatePerMin: number;
  viewerCount: number;
  startedAt: number;
}

export interface OpenLudoRoomSummary {
  roomCode: string;
  hostName: string;
  maxPlayers: 2 | 4;
  playerCount: number;
  entryCoins: number;
  prizeCoins: number;
  status: 'waiting' | 'playing' | 'finished';
}

export interface CoinTransaction {
  txId: string;
  userId: string;
  type:
    | 'coin_purchase'
    | 'call_spend'
    | 'gift_send'
    | 'gift_receive'
    | 'referral_bonus'
    | 'ludo_entry'
    | 'ludo_win'
    | 'welcome_bonus';
  amount: number;
  rupeesPaid: number;
  description: string;
  balanceAfter: number;
  createdAt?: unknown;
}

export interface ReferralClaim {
  claimantId: string;
  claimantName: string;
  referrerId: string;
  referrerCode: string;
  bonusCoins: number;
  claimedByReferrer: boolean;
  createdAt?: unknown;
}

export interface IncomingCallAlert {
  callId: string;
  callerId: string;
  callerName: string;
  callerCity: string;
  callType: 'video' | 'audio';
  ratePerMin: number;
}

export const INDIAN_CITIES: { city: string; state: string }[] = [
  { city: 'Mumbai', state: 'Maharashtra' },
  { city: 'New Delhi', state: 'Delhi' },
  { city: 'Bengaluru', state: 'Karnataka' },
  { city: 'Jaipur', state: 'Rajasthan' },
  { city: 'Hyderabad', state: 'Telangana' },
  { city: 'Chennai', state: 'Tamil Nadu' },
  { city: 'Kolkata', state: 'West Bengal' },
  { city: 'Pune', state: 'Maharashtra' },
  { city: 'Lucknow', state: 'Uttar Pradesh' },
  { city: 'Ahmedabad', state: 'Gujarat' },
  { city: 'Chandigarh', state: 'Punjab' },
  { city: 'Patna', state: 'Bihar' },
  { city: 'Indore', state: 'Madhya Pradesh' },
  { city: 'Kochi', state: 'Kerala' },
];

export const INDIAN_LANGUAGES = [
  'Hindi',
  'English',
  'Hinglish',
  'Marathi',
  'Tamil',
  'Telugu',
  'Bengali',
  'Punjabi',
  'Gujarati',
  'Kannada',
  'Malayalam',
];
