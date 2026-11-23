import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { Check, Copy, Gift, Share2, Users } from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { claimReferralBonusForReferrer } from '../lib/firestoreActions';
import { soundFx } from '../lib/soundFx';
import type { ReferralClaim, UserProfile } from '../types/app';

interface ReferralViewProps {
  profile: UserProfile;
  onProfileCoinsUpdated: (newCoins: number, newRefCount: number) => void;
}

export const ReferralView: React.FC<ReferralViewProps> = ({
  profile,
  onProfileCoinsUpdated,
}) => {
  const [claims, setClaims] = useState<ReferralClaim[]>([]);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'referralClaims'),
      where('referrerId', '==', profile.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: ReferralClaim[] = [];
        snap.forEach((d) => list.push(d.data() as ReferralClaim));
        setClaims(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'referralClaims')
    );
    return () => unsub();
  }, [profile.uid]);

  const inviteUrl = `${window.location.origin}/?ref=${profile.referralCode}`;

  const copyText = (text: string, type: 'code' | 'link') => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleShareInvite = async () => {
    const shareText = `Join me on RangLive for live video calls & multiplayer Ludo! Use my referral code ${profile.referralCode} for +100 bonus coins: ${inviteUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'RangLive Invite', text: shareText, url: inviteUrl });
        return;
      } catch {
        // Fallback to copy
      }
    }
    copyText(shareText, 'link');
  };

  const handleClaimBonus = async (claim: ReferralClaim) => {
    if (claim.claimedByReferrer) return;
    setClaimingId(claim.claimantId);
    try {
      await claimReferralBonusForReferrer({
        referrerUid: profile.uid,
        claim,
        currentCoins: profile.coins,
        currentEarned: profile.totalEarnedCoins,
        currentReferralCount: profile.referralCount,
      });
      soundFx.coinEarned();
      confetti({ particleCount: 65, spread: 65, origin: { y: 0.6 } });
      onProfileCoinsUpdated(profile.coins + claim.bonusCoins, profile.referralCount + 1);
    } finally {
      setClaimingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-[#131822] border border-white/10 p-6 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-7 space-y-4">
          <div className="text-xs font-medium text-amber-400">
            Refer &amp; Earn · +100 Coins Each
          </div>
          <h1 className="font-display text-2xl md:text-4xl font-bold text-white leading-tight">
            Invite Friends Across India &amp; Earn Free Coins
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
            Every friend who signs up with your code gets <strong className="text-white">+100 bonus coins</strong> immediately, and you unlock <strong className="text-amber-400">+100 coins</strong> to spend on video calls and Ludo tables.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={handleShareInvite}
              className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Share2 className="w-4 h-4" />
              Share Invite Link
            </button>
            <button
              onClick={() => copyText(inviteUrl, 'link')}
              className="px-4 py-3 rounded-xl border border-white/15 hover:bg-white/5 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
            >
              {copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied === 'link' ? 'Invite Link Copied' : 'Copy Link'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl bg-[#0B0E14] border border-white/10 p-6 space-y-4">
          <div className="text-xs text-slate-400">Your Personal Referral Code</div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-[#131822] border border-amber-500/30 px-4 py-3.5">
            <span className="font-mono text-2xl font-bold text-amber-400 tracking-widest">
              {profile.referralCode}
            </span>
            <button
              onClick={() => copyText(profile.referralCode, 'code')}
              className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              {copied === 'code' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied === 'code' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
            <div>
              <div className="text-xs text-slate-400">Friends Joined</div>
              <div className="font-mono text-xl font-bold text-white tabular-nums mt-0.5">
                {claims.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Referral Coins</div>
              <div className="font-mono text-xl font-bold text-emerald-400 tabular-nums mt-0.5">
                {(profile.referralCount * 100).toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Claimable & Completed Referrals List */}
      <div className="rounded-2xl bg-[#131822] border border-white/10 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <h2 className="font-display text-lg font-semibold text-white">Your Invited Friends</h2>
        </div>

        {claims.length > 0 ? (
          <div className="divide-y divide-white/5">
            {claims.map((claim) => (
              <div key={claim.claimantId} className="py-3.5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">{claim.claimantName}</div>
                  <div className="text-xs text-slate-400">
                    Used code <span className="font-mono">{claim.referrerCode}</span> · +{claim.bonusCoins} coins
                  </div>
                </div>
                {claim.claimedByReferrer ? (
                  <span className="text-xs font-semibold text-emerald-400">Claimed</span>
                ) : (
                  <button
                    onClick={() => handleClaimBonus(claim)}
                    disabled={claimingId === claim.claimantId}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Gift className="w-3.5 h-3.5" />
                    {claimingId === claim.claimantId ? 'Claiming...' : `Claim +${claim.bonusCoins}`}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-4">
            No friends have joined with your code yet. Share your referral code above to earn +100 coins per friend!
          </p>
        )}
      </div>
    </div>
  );
};
