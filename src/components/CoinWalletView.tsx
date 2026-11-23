import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { CheckCircle2, Coins, CreditCard, History, Smartphone, X } from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { recordCoinChange } from '../lib/firestoreActions';
import { soundFx } from '../lib/soundFx';
import type { CoinTransaction, UserProfile } from '../types/app';

interface CoinWalletViewProps {
  profile: UserProfile;
  onBalanceChange: (newBalance: number) => void;
}

const COIN_PACKS = [
  { id: 'starter', coins: 120, bonus: 20, rupees: 49, label: 'Starter Pack' },
  { id: 'value', coins: 350, bonus: 50, rupees: 129, label: 'Chai & Call Pack' },
  { id: 'popular', coins: 850, bonus: 150, rupees: 299, label: 'Most Popular' },
  { id: 'pro', coins: 2200, bonus: 400, rupees: 699, label: 'Creator VIP' },
  { id: 'royal', coins: 5500, bonus: 1200, rupees: 1499, label: 'Maharaja Vault' },
];

export const CoinWalletView: React.FC<CoinWalletViewProps> = ({
  profile,
  onBalanceChange,
}) => {
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [checkoutPack, setCheckoutPack] = useState<(typeof COIN_PACKS)[number] | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'card'>('upi');
  const [upiId, setUpiId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [receiptMsg, setReceiptMsg] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', profile.uid),
      orderBy('createdAt', 'desc'),
      limit(25)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: CoinTransaction[] = [];
        snap.forEach((d) => list.push(d.data() as CoinTransaction));
        setTransactions(list);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    );
    return () => unsub();
  }, [profile.uid]);

  const handleConfirmPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutPack) return;
    setProcessing(true);
    try {
      const totalCoins = checkoutPack.coins + checkoutPack.bonus;
      const newBal = await recordCoinChange({
        uid: profile.uid,
        currentCoins: profile.coins,
        currentEarned: profile.totalEarnedCoins,
        delta: totalCoins,
        rupeesPaid: checkoutPack.rupees,
        type: 'coin_purchase',
        description: `Purchased ${checkoutPack.label} (${totalCoins} coins · ₹${checkoutPack.rupees})`,
      });
      onBalanceChange(newBal);
      soundFx.coinEarned();
      confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
      setReceiptMsg(`${totalCoins} coins credited to your RangLive wallet!`);
      setCheckoutPack(null);
      setUpiId('');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Wallet Hero Summary */}
      <div className="rounded-3xl bg-[#131822] border border-white/10 p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="text-xs font-medium text-amber-400">RangLive Coin Wallet</div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-4xl md:text-5xl font-bold text-white tabular-nums">
              {profile.coins.toLocaleString('en-IN')}
            </span>
            <span className="text-sm text-slate-400">available coins</span>
          </div>
          <p className="text-xs text-slate-400">
            Use coins for 1-on-1 live video calls, stream gifts, and Ludo prize tables.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6 pt-4 md:pt-0 border-t md:border-t-0 md:border-l border-white/10 md:pl-8">
          <div>
            <div className="text-xs text-slate-400">Total Earned</div>
            <div className="font-mono text-xl font-semibold text-emerald-400 tabular-nums mt-0.5">
              {profile.totalEarnedCoins.toLocaleString('en-IN')}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Referrals</div>
            <div className="font-mono text-xl font-semibold text-white tabular-nums mt-0.5">
              {profile.referralCount}
            </div>
          </div>
        </div>
      </div>

      {receiptMsg && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 flex items-center justify-between text-xs text-emerald-300">
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            {receiptMsg}
          </span>
          <button onClick={() => setReceiptMsg(null)} className="text-emerald-200 hover:text-white cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Coin Packs Grid */}
      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold text-white">Buy Coins (INR ₹)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {COIN_PACKS.map((pack) => (
            <div
              key={pack.id}
              className="rounded-2xl bg-[#131822] border border-white/10 p-5 flex flex-col justify-between space-y-5 hover:border-amber-500/40 transition-colors"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{pack.label}</span>
                  <span className="font-mono text-emerald-400">+{pack.bonus} bonus</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Coins className="w-6 h-6 text-amber-400 shrink-0" />
                  <span className="font-mono text-2xl font-bold text-white tabular-nums">
                    {(pack.coins + pack.bonus).toLocaleString('en-IN')}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono tabular-nums">
                  {pack.coins} base + {pack.bonus} extra coins
                </p>
              </div>

              <button
                onClick={() => setCheckoutPack(pack)}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-sm transition-colors cursor-pointer"
              >
                Buy for ₹{pack.rupees}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction Passbook */}
      <div className="rounded-2xl bg-[#131822] border border-white/10 p-6 space-y-4">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          <h2 className="font-display text-lg font-semibold text-white">Coin Passbook</h2>
        </div>

        {transactions.length > 0 ? (
          <div className="divide-y divide-white/5">
            {transactions.map((tx) => (
              <div key={tx.txId} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white truncate">{tx.description}</div>
                  <div className="text-xs text-slate-400">
                    Balance after: <span className="font-mono tabular-nums">{tx.balanceAfter}</span>
                    {tx.rupeesPaid > 0 ? ` · Paid ₹${tx.rupeesPaid}` : ''}
                  </div>
                </div>
                <div
                  className={`font-mono text-sm font-bold tabular-nums shrink-0 ${
                    tx.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {tx.amount >= 0 ? `+${tx.amount}` : tx.amount}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-4">No coin activity recorded yet.</p>
        )}
      </div>

      {/* Indian UPI / Card Checkout Modal */}
      {checkoutPack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleConfirmPurchase}
            className="w-full max-w-md rounded-3xl bg-[#131822] border border-white/10 p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl font-semibold text-white">
                Complete Coin Recharge
              </h3>
              <button
                type="button"
                onClick={() => setCheckoutPack(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-2xl bg-[#0B0E14] border border-white/10 p-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">{checkoutPack.label}</div>
                <div className="font-mono text-lg font-bold text-amber-400 tabular-nums">
                  {(checkoutPack.coins + checkoutPack.bonus).toLocaleString('en-IN')} Coins
                </div>
              </div>
              <div className="font-mono text-xl font-bold text-white tabular-nums">
                ₹{checkoutPack.rupees}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('upi')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  paymentMethod === 'upi'
                    ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 text-slate-400'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                UPI / PhonePe / GPay
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('card')}
                className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer ${
                  paymentMethod === 'card'
                    ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                    : 'border-white/10 text-slate-400'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                RuPay / Card
              </button>
            </div>

            {paymentMethod === 'upi' && (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">
                  UPI ID (PhonePe / GPay / Paytm / BHIM)
                </label>
                <input
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="yourname@okaxis"
                  className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                  required
                />
              </div>
            )}

            <button
              type="submit"
              disabled={processing}
              className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              {processing ? 'Confirming Recharge...' : `Pay ₹${checkoutPack.rupees} & Credit Coins`}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
