/**
 * Payload-First Security TDD Test Suite for RangLive Firestore Rules.
 * Verifies that all "Dirty Dozen" adversarial payloads are rejected with PERMISSION_DENIED.
 */

export interface AdversarialTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  authUid: string | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const dirtyDozenTests: AdversarialTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated write to publicProfiles',
    collectionPath: 'publicProfiles/user1',
    operation: 'create',
    authUid: null,
    payload: { uid: 'user1', displayName: 'Fake' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'PII cross-read on private users doc',
    collectionPath: 'users/userA',
    operation: 'get',
    authUid: 'userB',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'User list scrape on users collection',
    collectionPath: 'users',
    operation: 'list',
    authUid: 'userA',
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Identity spoofing on transaction creation',
    collectionPath: 'transactions/tx1',
    operation: 'create',
    authUid: 'userA',
    payload: { txId: 'tx1', userId: 'userB', type: 'coin_purchase', amount: 500 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Ghost field shadow update on users doc',
    collectionPath: 'users/userA',
    operation: 'update',
    authUid: 'userA',
    payload: { isAdmin: true, coins: 9999999 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'ID poisoning with invalid characters',
    collectionPath: 'streams/bad$id!@#',
    operation: 'create',
    authUid: 'userA',
    payload: { streamId: 'bad$id!@#', hostId: 'userA' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Timestamp forgery with client-side date',
    collectionPath: 'publicProfiles/userA',
    operation: 'create',
    authUid: 'userA',
    payload: { uid: 'userA', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immutability breach altering createdAt on update',
    collectionPath: 'users/userA',
    operation: 'update',
    authUid: 'userA',
    payload: { createdAt: 'request.time' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Terminal state resurrection on ended stream',
    collectionPath: 'streams/stream1',
    operation: 'update',
    authUid: 'userA',
    payload: { status: 'live' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned message under nonexistent parent stream',
    collectionPath: 'streams/missing_stream/messages/msg1',
    operation: 'create',
    authUid: 'userA',
    payload: { messageId: 'msg1', streamId: 'missing_stream', senderId: 'userA', text: 'Hi' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Referral self-claim attempt',
    collectionPath: 'referralClaims/userA',
    operation: 'create',
    authUid: 'userA',
    payload: { claimantId: 'userA', referrerId: 'userA', referrerCode: 'MYCODE', bonusCoins: 100 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Immutable transaction deletion attempt',
    collectionPath: 'transactions/tx1',
    operation: 'delete',
    authUid: 'userA',
    expectedResult: 'PERMISSION_DENIED',
  },
];
