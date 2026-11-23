# RangLive Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **PII Isolation**: Private user fields (`phoneNumber`, `email`, `coins`) live strictly in `/users/{userId}` and are readable/writable ONLY by `request.auth.uid == userId`. Public creator/player browsing uses `/publicProfiles/{userId}` which contains zero PII.
2. **Identity Integrity**: Every document created by a user must bind its owner field (`uid`, `userId`, `hostId`, `senderId`, `callerId`, `claimantId`, `ownerId`) strictly to `request.auth.uid`.
3. **Path Variable Hardening**: Every document ID parameter (`userId`, `code`, `claimantId`, `txId`, `streamId`, `messageId`, `callId`, `matchId`) must match `^[a-zA-Z0-9_\\-]+$` and length `<= 128`.
4. **Immutability & Terminal Locking**:
   - `/referralCodes/{code}` and `/transactions/{txId}` are strictly immutable after creation.
   - `/streams/{streamId}` cannot transition out of `status == 'ended'`.
   - `/callRecords/{callId}` cannot transition out of `status in ['ended', 'missed']`.
   - `/ludoMatches/{matchId}` cannot transition out of `status == 'finished'`.
5. **Temporal Integrity**: `createdAt` must equal `request.time` on create and remain immutable; `updatedAt` must equal `request.time` on create and update.
6. **Master Gate on Subcollections**: `/streams/{streamId}/messages/{messageId}` requires the parent `/streams/{streamId}` document to exist.
7. **Secure List Queries**:
   - `/users/{userId}` and `/referralCodes/{code}` disallow `list` completely.
   - `/transactions/{txId}` enforces `resource.data.userId == request.auth.uid` on `list`.
   - `/referralClaims/{claimantId}` enforces `resource.data.claimantId == request.auth.uid || resource.data.referrerId == request.auth.uid` on `list`.
   - `/callRecords/{callId}` enforces `resource.data.callerId == request.auth.uid || resource.data.calleeId == request.auth.uid` on `list`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Write**: Creating `/publicProfiles/u1` with `auth == null`.
2. **PII Cross-Read**: User B calling `get` on `/users/userA` to read User A's `phoneNumber`.
3. **User List Scrape**: User A calling `list` on `/users` to enumerate all phone numbers.
4. **Identity Spoofing on Transaction**: User A creating `/transactions/tx1` with `userId: "userB"`.
5. **Ghost Field Shadow Update**: User A updating `/users/userA` with an unexpected field `isAdmin: true`.
6. **ID Poisoning**: Creating `/streams/invalid$id!@#` violating `isValidId()`.
7. **Timestamp Forgery**: Creating `/publicProfiles/userA` with `createdAt` set to a past client date instead of `request.time`.
8. **Immutability Breach on `createdAt`**: Updating `/users/userA` while altering `createdAt`.
9. **Terminal State Resurrection**: Host updating `/streams/s1` from `status: "ended"` back to `status: "live"`.
10. **Orphaned Stream Message**: Creating `/streams/nonexistent_stream/messages/m1`.
11. **Referral Self-Claim**: User A creating `/referralClaims/userA` where `referrerId == "userA"`.
12. **Transaction Tampering**: User A attempting `update` or `delete` on `/transactions/tx1` to erase spent coins.
