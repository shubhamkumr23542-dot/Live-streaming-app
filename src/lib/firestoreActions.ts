import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import type { CoinTransaction, ReferralClaim, UserProfile } from '../types/app';

const AVATAR_COLORS = ['#F59E0B', '#E11D48', '#10B981', '#3B82F6', '#EA580C', '#0D9488'];

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return cleaned || `id_${Date.now()}`;
}

export function makeUniqueId(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 8);
  return sanitizeId(`${prefix}_${Date.now()}_${rand}`);
}

export function generateReferralCode(seedName: string): string {
  const clean = seedName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4) || 'RANG';
  const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${clean}${suffix}`.slice(0, 12);
}

export interface OnboardingPayload {
  uid: string;
  displayName: string;
  phoneNumber: string;
  phoneVerified: boolean;
  email: string;
  city: string;
  state: string;
  language: string;
  referredByCode?: string;
}

export async function createAccountWithReferral(
  payload: OnboardingPayload
): Promise<{ profile: UserProfile; referralApplied: boolean; referrerName?: string }> {
  const uid = sanitizeId(payload.uid);
  const displayName = payload.displayName.trim().slice(0, 60) || 'Player';
  const myCode = generateReferralCode(displayName);
  const avatarColor = AVATAR_COLORS[uid.charCodeAt(0) % AVATAR_COLORS.length];

  let referralApplied = false;
  let referrerId = '';
  let referrerName = '';
  let appliedCode = '';

  const candidateCode = (payload.referredByCode || '').trim().toUpperCase();
  if (candidateCode && /^[A-Z0-9]{4,16}$/.test(candidateCode)) {
    try {
      const codeSnap = await getDoc(doc(db, 'referralCodes', candidateCode));
      if (codeSnap.exists()) {
        const data = codeSnap.data();
        if (data.ownerId && data.ownerId !== uid) {
          referralApplied = true;
          referrerId = String(data.ownerId);
          referrerName = String(data.ownerName || 'Friend');
          appliedCode = candidateCode;
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `referralCodes/${candidateCode}`);
    }
  }

  const initialCoins = referralApplied ? 250 : 150;
  const batch = writeBatch(db);

  const userRef = doc(db, 'users', uid);
  const userData = {
    uid,
    displayName,
    phoneNumber: payload.phoneNumber.slice(0, 20),
    phoneVerified: payload.phoneVerified,
    email: payload.email.slice(0, 120),
    city: payload.city.slice(0, 50),
    state: payload.state.slice(0, 50),
    language: payload.language.slice(0, 40),
    coins: initialCoins,
    referralCode: myCode,
    referredBy: appliedCode,
    referralCount: 0,
    totalEarnedCoins: initialCoins,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  batch.set(userRef, userData);

  const publicRef = doc(db, 'publicProfiles', uid);
  batch.set(publicRef, {
    uid,
    displayName,
    city: payload.city.slice(0, 50),
    state: payload.state.slice(0, 50),
    language: payload.language.slice(0, 40),
    referralCode: myCode,
    isOnline: true,
    isLive: false,
    callRatePerMin: 20,
    winsCount: 0,
    avatarColor,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const codeRef = doc(db, 'referralCodes', myCode);
  batch.set(codeRef, {
    code: myCode,
    ownerId: uid,
    ownerName: displayName,
    createdAt: serverTimestamp(),
  });

  const welcomeTxId = makeUniqueId('tx_welcome');
  batch.set(doc(db, 'transactions', welcomeTxId), {
    txId: welcomeTxId,
    userId: uid,
    type: 'welcome_bonus',
    amount: 150,
    rupeesPaid: 0,
    description: 'RangLive joining welcome coins',
    balanceAfter: referralApplied ? 150 : 150,
    createdAt: serverTimestamp(),
  });

  if (referralApplied) {
    batch.set(doc(db, 'referralClaims', uid), {
      claimantId: uid,
      claimantName: displayName,
      referrerId,
      referrerCode: appliedCode,
      bonusCoins: 100,
      claimedByReferrer: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const refTxId = makeUniqueId('tx_ref');
    batch.set(doc(db, 'transactions', refTxId), {
      txId: refTxId,
      userId: uid,
      type: 'referral_bonus',
      amount: 100,
      rupeesPaid: 0,
      description: `Joined with invite code ${appliedCode}`,
      balanceAfter: initialCoins,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }

  return {
    profile: {
      uid,
      displayName,
      phoneNumber: userData.phoneNumber,
      phoneVerified: userData.phoneVerified,
      email: userData.email,
      city: userData.city,
      state: userData.state,
      language: userData.language,
      coins: initialCoins,
      referralCode: myCode,
      referredBy: appliedCode,
      referralCount: 0,
      totalEarnedCoins: initialCoins,
    },
    referralApplied,
    referrerName,
  };
}

export async function recordCoinChange(params: {
  uid: string;
  currentCoins: number;
  currentEarned: number;
  delta: number;
  rupeesPaid?: number;
  type: CoinTransaction['type'];
  description: string;
}): Promise<number> {
  const newBalance = Math.max(0, params.currentCoins + params.delta);
  const earnedInc = params.delta > 0 ? params.delta : 0;
  const batch = writeBatch(db);

  batch.update(doc(db, 'users', params.uid), {
    coins: newBalance,
    totalEarnedCoins: params.currentEarned + earnedInc,
    updatedAt: serverTimestamp(),
  });

  const txId = makeUniqueId('tx');
  batch.set(doc(db, 'transactions', txId), {
    txId,
    userId: params.uid,
    type: params.type,
    amount: params.delta,
    rupeesPaid: params.rupeesPaid ?? 0,
    description: params.description.slice(0, 160),
    balanceAfter: newBalance,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return newBalance;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${params.uid}`);
  }
}

export async function claimReferralBonusForReferrer(params: {
  referrerUid: string;
  claim: ReferralClaim;
  currentCoins: number;
  currentEarned: number;
  currentReferralCount: number;
}) {
  const newBalance = params.currentCoins + params.claim.bonusCoins;
  const batch = writeBatch(db);

  batch.update(doc(db, 'referralClaims', params.claim.claimantId), {
    claimedByReferrer: true,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'users', params.referrerUid), {
    coins: newBalance,
    referralCount: params.currentReferralCount + 1,
    totalEarnedCoins: params.currentEarned + params.claim.bonusCoins,
    updatedAt: serverTimestamp(),
  });

  const txId = makeUniqueId('tx_ref_claim');
  batch.set(doc(db, 'transactions', txId), {
    txId,
    userId: params.referrerUid,
    type: 'referral_bonus',
    amount: params.claim.bonusCoins,
    rupeesPaid: 0,
    description: `Referral reward from ${params.claim.claimantName}`,
    balanceAfter: newBalance,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `referralClaims/${params.claim.claimantId}`);
  }
}

export async function updateOnlineAndRate(
  uid: string,
  updates: Partial<{ isOnline: boolean; isLive: boolean; callRatePerMin: number; winsCount: number }>
) {
  try {
    await updateDoc(doc(db, 'publicProfiles', uid), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `publicProfiles/${uid}`);
  }
}

export async function createLiveStreamDoc(params: {
  streamId: string;
  hostId: string;
  hostName: string;
  hostCity: string;
  title: string;
  category: string;
  language: string;
  callRatePerMin: number;
}) {
  try {
    await setDoc(doc(db, 'streams', params.streamId), {
      streamId: params.streamId,
      hostId: params.hostId,
      hostName: params.hostName.slice(0, 60),
      hostCity: params.hostCity.slice(0, 50),
      title: params.title.slice(0, 100),
      category: params.category.slice(0, 40),
      language: params.language.slice(0, 40),
      status: 'live',
      viewerCount: 1,
      callRatePerMin: params.callRatePerMin,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `streams/${params.streamId}`);
  }
}

export async function endLiveStreamDoc(streamId: string) {
  try {
    await updateDoc(doc(db, 'streams', streamId), {
      status: 'ended',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `streams/${streamId}`);
  }
}

export async function saveStreamMessageDoc(params: {
  streamId: string;
  senderId: string;
  senderName: string;
  text: string;
  giftName: string;
  giftCoins: number;
}) {
  const messageId = makeUniqueId('msg');
  try {
    await setDoc(doc(collection(db, 'streams', params.streamId, 'messages'), messageId), {
      messageId,
      streamId: params.streamId,
      senderId: params.senderId,
      senderName: params.senderName.slice(0, 60),
      text: params.text.slice(0, 300),
      giftName: params.giftName.slice(0, 40),
      giftCoins: params.giftCoins,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Non-fatal if stream doc was WebSocket-only
    console.warn('Could not persist stream message:', err);
  }
}

export async function saveLudoMatchResult(params: {
  roomCode: string;
  hostId: string;
  hostName: string;
  playersCount: number;
  entryCoins: number;
  prizeCoins: number;
  winnerName: string;
}) {
  const matchId = makeUniqueId('ludo');
  try {
    await setDoc(doc(db, 'ludoMatches', matchId), {
      matchId,
      roomCode: params.roomCode,
      hostId: params.hostId,
      hostName: params.hostName.slice(0, 60),
      playersCount: params.playersCount,
      entryCoins: params.entryCoins,
      prizeCoins: params.prizeCoins,
      winnerName: params.winnerName.slice(0, 60),
      status: 'finished',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `ludoMatches/${matchId}`);
  }
}
