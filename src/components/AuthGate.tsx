import React, { useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { ArrowRight, CheckCircle2, Gift, Phone, ShieldCheck, Video } from 'lucide-react';
import { auth } from '../lib/firebase';
import { createAccountWithReferral } from '../lib/firestoreActions';
import { INDIAN_CITIES, INDIAN_LANGUAGES, type UserProfile } from '../types/app';
import { GENERATED_IMAGES } from './BrandAssets';

interface AuthGateProps {
  firebaseUser: User | null;
  onProfileCreated: (profile: UserProfile, referralMessage?: string) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({ firebaseUser, onProfileCreated }) => {
  const [authTab, setAuthTab] = useState<'phone' | 'google'>('phone');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [serverOtpHint, setServerOtpHint] = useState<string | null>(null);
  const [phoneVerifiedLocally, setPhoneVerifiedLocally] = useState(false);
  const [verifiedPhoneE164, setVerifiedPhoneE164] = useState('');
  const [firebaseConfirmResult, setFirebaseConfirmResult] = useState<ConfirmationResult | null>(null);
  const [showConsoleGuide, setShowConsoleGuide] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [cityIdx, setCityIdx] = useState(0);
  const [language, setLanguage] = useState('Hindi');
  const [referralCode, setReferralCode] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const recaptchaRef = useRef<HTMLDivElement | null>(null);
  const recaptchaInstanceRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const refParam = params.get('ref');
    if (refParam) {
      setReferralCode(refParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16));
    }
  }, []);

  useEffect(() => {
    if (firebaseUser) {
      if (firebaseUser.displayName && !displayName) {
        setDisplayName(firebaseUser.displayName);
      }
      if (firebaseUser.phoneNumber) {
        setVerifiedPhoneE164(firebaseUser.phoneNumber);
        setPhoneVerifiedLocally(true);
        setPhoneDigits(firebaseUser.phoneNumber.replace(/^\+91/, ''));
      }
    }
  }, [firebaseUser, displayName]);

  const cleanPhone = phoneDigits.replace(/\D/g, '').slice(-10);
  const formattedPhone = cleanPhone.length === 10 ? `+91${cleanPhone}` : '';

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (cleanPhone.length !== 10) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    setLoading(true);
    try {
      // First attempt native Firebase Phone Auth if enabled on the Firebase project
      if (!firebaseUser && recaptchaRef.current) {
        try {
          if (!recaptchaInstanceRef.current) {
            recaptchaInstanceRef.current = new RecaptchaVerifier(auth, recaptchaRef.current, {
              size: 'invisible',
            });
          }
          const confirmation = await signInWithPhoneNumber(
            auth,
            formattedPhone,
            recaptchaInstanceRef.current
          );
          setFirebaseConfirmResult(confirmation);
          setOtpSent(true);
          setServerOtpHint(null);
          setLoading(false);
          return;
        } catch (fbErr: unknown) {
          const code = (fbErr as { code?: string })?.code || '';
          if (code === 'auth/operation-not-allowed' || code === 'auth/billing-not-enabled') {
            setShowConsoleGuide(true);
          }
          // Fall back cleanly to server-verified OTP + Google Auth link
          recaptchaInstanceRef.current?.clear();
          recaptchaInstanceRef.current = null;
        }
      }

      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: formattedPhone }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not send OTP.');
      }
      setOtpSent(true);
      setServerOtpHint(data.verificationCode || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (otpInput.trim().length !== 6) {
      setError('Enter the 6-digit OTP code.');
      return;
    }

    setLoading(true);
    try {
      if (firebaseConfirmResult) {
        await firebaseConfirmResult.confirm(otpInput.trim());
        setVerifiedPhoneE164(formattedPhone);
        setPhoneVerifiedLocally(true);
        setLoading(false);
        return;
      }

      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: formattedPhone, otp: otpInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Invalid OTP.');
      }
      setVerifiedPhoneE164(data.phoneNumber);
      setPhoneVerifiedLocally(true);
      setServerOtpHint(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setError(null);

    if (displayName.trim().length < 2) {
      setError('Please enter your display name (at least 2 characters).');
      return;
    }

    if (!phoneVerifiedLocally && cleanPhone.length === 10) {
      setError('Please verify your mobile number with OTP before continuing.');
      return;
    }

    setLoading(true);
    try {
      const selectedCity = INDIAN_CITIES[cityIdx] || INDIAN_CITIES[0];
      const result = await createAccountWithReferral({
        uid: firebaseUser.uid,
        displayName: displayName.trim(),
        phoneNumber: verifiedPhoneE164 || formattedPhone || '',
        phoneVerified: phoneVerifiedLocally,
        email: firebaseUser.email || '',
        city: selectedCity.city,
        state: selectedCity.state,
        language,
        referredByCode: referralCode,
      });

      const msg = result.referralApplied
        ? `Referral code applied! You earned +100 bonus coins (250 coins total).`
        : `Welcome to RangLive! 150 starter coins added to your wallet.`;
      onProfileCreated(result.profile, msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your profile.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex items-center justify-center p-4 md:p-8">
      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Editorial Hero Showcase */}
        <div className="lg:col-span-7 relative rounded-3xl overflow-hidden bg-[#131822] border border-white/10 min-h-[340px] lg:min-h-[640px] flex flex-col justify-end">
          {!imgFailed ? (
            <img
              src={GENERATED_IMAGES.heroStream}
              alt="Indian live creator broadcasting on RangLive"
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-amber-950/60 via-[#131822] to-rose-950/50 flex items-center justify-center">
              <Video className="w-16 h-16 text-amber-400/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B0E14] via-[#0B0E14]/70 to-transparent" />

          <div className="relative z-10 p-6 md:p-10 space-y-5">
            <div className="flex items-center gap-2 text-xs font-medium text-amber-300">
              <span>All-India Live Streaming</span>
              <span aria-hidden="true">·</span>
              <span>1-on-1 Video Chat</span>
              <span aria-hidden="true">·</span>
              <span>Multiplayer Ludo</span>
            </div>

            <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight text-white leading-tight max-w-xl">
              Live Video Chat, Streaming &amp; Ludo Across India
            </h1>

            <p className="text-sm md:text-base text-slate-300 max-w-lg leading-relaxed">
              Connect face-to-face with creators and friends from Mumbai to Jaipur, host live rooms, play 4-player Ludo matches, and earn coins when friends join with your code.
            </p>

            <div className="grid grid-cols-3 gap-4 pt-3 border-t border-white/10 max-w-lg">
              <div>
                <div className="font-mono text-lg font-semibold text-amber-400 tabular-nums">150</div>
                <div className="text-xs text-slate-400">Starter Coins</div>
              </div>
              <div>
                <div className="font-mono text-lg font-semibold text-white tabular-nums">+100</div>
                <div className="text-xs text-slate-400">Per Referral</div>
              </div>
              <div>
                <div className="font-mono text-lg font-semibold text-emerald-400 tabular-nums">2–4P</div>
                <div className="text-xs text-slate-400">Live Ludo</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sign-In & Onboarding Panel */}
        <div className="lg:col-span-5 bg-[#131822] border border-white/10 rounded-3xl p-6 md:p-8 flex flex-col justify-between">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <span className="font-display text-2xl font-bold tracking-tight text-white">
                RangLive
              </span>
              <span className="text-xs text-slate-400">Pan-India Club</span>
            </div>

            {!firebaseUser ? (
              <>
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-semibold text-white">
                    {phoneVerifiedLocally ? 'One last step to enter' : 'Sign in with Phone or Google'}
                  </h2>
                  <p className="text-sm text-slate-400">
                    Verify your +91 mobile number and apply a referral code for extra coins.
                  </p>
                </div>

                {/* Segmented Control */}
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#0B0E14] rounded-xl border border-white/5">
                  <button
                    type="button"
                    onClick={() => setAuthTab('phone')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      authTab === 'phone'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Phone +91 OTP
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthTab('google')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      authTab === 'google'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Google Sign-In
                  </button>
                </div>

                {authTab === 'phone' && !phoneVerifiedLocally && (
                  <div className="space-y-4">
                    {!otpSent ? (
                      <form onSubmit={handleSendOtp} className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-300">
                            Indian Mobile Number
                          </label>
                          <div className="flex items-center rounded-xl bg-[#0B0E14] border border-white/10 focus-within:border-amber-500 transition-colors">
                            <span className="px-3.5 py-3 text-sm font-mono text-amber-400 border-r border-white/10">
                              +91
                            </span>
                            <input
                              type="tel"
                              inputMode="numeric"
                              maxLength={10}
                              value={phoneDigits}
                              onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 10))}
                              placeholder="9876543210"
                              className="w-full bg-transparent px-3.5 py-3 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none"
                              required
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-300">
                            Referral Code (Optional · +100 Coins)
                          </label>
                          <input
                            type="text"
                            maxLength={16}
                            value={referralCode}
                            onChange={(e) =>
                              setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                            }
                            placeholder="e.g. RANG8421"
                            className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-3 text-sm font-mono text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                          />
                        </div>

                        <div ref={recaptchaRef} />

                        <button
                          type="submit"
                          disabled={loading || cleanPhone.length !== 10}
                          className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                        >
                          <Phone className="w-4 h-4" />
                          {loading ? 'Sending OTP...' : 'Send 6-Digit OTP'}
                        </button>
                      </form>
                    ) : (
                      <form onSubmit={handleVerifyOtp} className="space-y-4">
                        {serverOtpHint && (
                          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs text-amber-200 space-y-1">
                            <div className="font-semibold text-amber-300">
                              Instant Verification OTP: <span className="font-mono text-sm">{serverOtpHint}</span>
                            </div>
                            <p className="text-amber-200/80">
                              Enter this 6-digit code to verify {formattedPhone}.
                            </p>
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="block text-xs font-medium text-slate-300">
                            Enter 6-Digit OTP sent to {formattedPhone}
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={otpInput}
                            onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="123456"
                            className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-4 py-3 text-center text-lg font-mono tracking-[0.4em] text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                            required
                          />
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setOtpSent(false);
                              setOtpInput('');
                            }}
                            className="px-4 py-3 rounded-xl border border-white/10 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
                          >
                            Change Number
                          </button>
                          <button
                            type="submit"
                            disabled={loading || otpInput.length !== 6}
                            className="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
                          >
                            {loading ? 'Verifying...' : 'Verify OTP'}
                          </button>
                        </div>
                      </form>
                    )}

                    {showConsoleGuide && (
                      <div className="rounded-xl bg-white/5 border border-white/10 p-3 text-xs text-slate-400 leading-relaxed">
                        Firebase native SMS requires enabling Phone Provider in Firebase Console. Your number is verified securely via RangLive OTP and linked to your account on the next step.
                      </div>
                    )}
                  </div>
                )}

                {(authTab === 'google' || phoneVerifiedLocally) && (
                  <div className="space-y-4">
                    {phoneVerifiedLocally && (
                      <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3.5 text-xs text-emerald-300">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Mobile {verifiedPhoneE164} verified! Sign in with Google to activate your cloud wallet.</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={loading}
                      className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-semibold text-sm flex items-center justify-center gap-3 transition-colors cursor-pointer"
                    >
                      <ShieldCheck className="w-4 h-4 text-amber-600" />
                      {loading ? 'Signing in...' : 'Continue with Google'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              /* Authenticated via Firebase, now complete Indian Profile + Phone + Referral */
              <form onSubmit={handleCompleteOnboarding} className="space-y-4">
                <div className="space-y-1">
                  <h2 className="font-display text-2xl font-semibold text-white">
                    Complete Your Profile
                  </h2>
                  <p className="text-sm text-slate-400">
                    Set your display name, city, and mobile number to start streaming &amp; playing Ludo.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-300">Display Name</label>
                  <input
                    type="text"
                    maxLength={60}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Rohan Sharma"
                    className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                    required
                  />
                </div>

                {/* Mobile Verification inside Onboarding if user came straight via Google */}
                {!phoneVerifiedLocally ? (
                  <div className="rounded-xl bg-[#0B0E14] border border-white/10 p-3.5 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-300">Verify +91 Mobile Number</span>
                      <span className="text-amber-400">Required for Calls</span>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex flex-1 items-center rounded-lg bg-[#131822] border border-white/10">
                        <span className="px-2.5 text-xs font-mono text-amber-400">+91</span>
                        <input
                          type="tel"
                          maxLength={10}
                          value={phoneDigits}
                          onChange={(e) =>
                            setPhoneDigits(e.target.value.replace(/\D/g, '').slice(0, 10))
                          }
                          placeholder="9876543210"
                          className="w-full bg-transparent py-2 pr-2 text-xs font-mono text-white focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={loading || cleanPhone.length !== 10}
                        className="px-3 py-2 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                      >
                        {otpSent ? 'Resend' : 'Send OTP'}
                      </button>
                    </div>
                    {otpSent && (
                      <div className="space-y-2">
                        {serverOtpHint && (
                          <div className="text-xs text-amber-300">
                            OTP Code: <span className="font-mono font-semibold">{serverOtpHint}</span>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            maxLength={6}
                            value={otpInput}
                            onChange={(e) =>
                              setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))
                            }
                            placeholder="6-digit OTP"
                            className="flex-1 rounded-lg bg-[#131822] border border-white/10 px-3 py-2 text-xs font-mono text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleVerifyOtp}
                            disabled={loading || otpInput.length !== 6}
                            className="px-3 py-2 rounded-lg bg-emerald-500 text-slate-950 text-xs font-semibold hover:bg-emerald-400 disabled:opacity-40 cursor-pointer"
                          >
                            Verify
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3.5 py-2.5 text-xs text-emerald-300">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Phone Verified
                    </span>
                    <span className="font-mono">{verifiedPhoneE164 || formattedPhone}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">City</label>
                    <select
                      value={cityIdx}
                      onChange={(e) => setCityIdx(Number(e.target.value))}
                      className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                    >
                      {INDIAN_CITIES.map((c, idx) => (
                        <option key={c.city} value={idx}>
                          {c.city}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-300">Language</label>
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2.5 text-sm text-white focus:border-amber-500 focus:outline-none"
                    >
                      {INDIAN_LANGUAGES.map((lang) => (
                        <option key={lang} value={lang}>
                          {lang}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                    <Gift className="w-3.5 h-3.5 text-amber-400" />
                    <span>Friend's Referral Code (Optional · +100 Coins)</span>
                  </label>
                  <input
                    type="text"
                    maxLength={16}
                    value={referralCode}
                    onChange={(e) =>
                      setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                    }
                    placeholder="Enter invite code"
                    className="w-full rounded-xl bg-[#0B0E14] border border-white/10 px-3.5 py-2.5 text-sm font-mono text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{loading ? 'Creating Wallet...' : 'Enter RangLive'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {error && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
                {error}
              </div>
            )}
          </div>

          <p className="pt-6 border-t border-white/5 text-xs text-slate-500">
            By continuing, you agree to RangLive's community guidelines for safe Pan-India video chat and fair Ludo gameplay.
          </p>
        </div>
      </div>
    </div>
  );
};
