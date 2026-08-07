// services/voiceDirector.js
// Akasha Whisper v1.0
//
// Important safety properties:
// 1. Only this server module may decide whether a Whisper is emitted.
// 2. Free users never call ElevenLabs.
// 3. Firestore writes use transactions and only update voice-related fields.
// 4. Existing user profile, membership, capsule, and memory fields are never
//    replaced or deleted.

const admin = require('firebase-admin');

const { generateAkashaVoice } = require('./voiceService');
const {
  evaluateVoiceCandidate,
  buildVoiceLine,
} = require('./voiceCandidateService');

const FIRST_SCORE_MIN = Number(
  process.env.AKASHA_VOICE_FIRST_SCORE_MIN || 70,
);
const FOLLOW_UP_SCORE_MIN = Number(
  process.env.AKASHA_VOICE_FOLLOWUP_SCORE_MIN || 55,
);
const COOLDOWN_HOURS = Number(
  process.env.AKASHA_VOICE_COOLDOWN_HOURS || 20,
);

let firebaseReady = false;

function ensureFirebaseAdmin() {
  if (firebaseReady && admin.apps.length > 0) {
    return admin.firestore();
  }

  if (admin.apps.length === 0) {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();

    if (!raw) {
      const error = new Error('FIREBASE_SERVICE_ACCOUNT is missing');
      error.code = 'VOICE_FIREBASE_CONFIG_MISSING';
      error.status = 503;
      throw error;
    }

    let serviceAccount;

    try {
      serviceAccount = JSON.parse(raw);
    } catch (error) {
      const wrapped = new Error(
        'FIREBASE_SERVICE_ACCOUNT is not valid JSON',
      );
      wrapped.code = 'VOICE_FIREBASE_CONFIG_INVALID';
      wrapped.status = 503;
      throw wrapped;
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  firebaseReady = true;
  return admin.firestore();
}

function normalizeTier(data = {}) {
  return String(data.membershipTier || data.plan || 'free')
    .trim()
    .toLowerCase();
}

function isMemberTier(tier) {
  return [
    'member',
    'premium',
    'pro',
    'plus',
    'vip',
    'paid',
    'founder',
    'founding_member',
  ].includes(tier);
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateFromValue(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function weeksElapsed(from, to) {
  if (!from) return 0;
  const diff = to.getTime() - from.getTime();
  if (diff < 7 * 24 * 60 * 60 * 1000) return 0;
  return Math.floor(diff / (7 * 24 * 60 * 60 * 1000));
}

function applyWeeklyRefill(data, now, isMember) {
  const opportunityMax = isMember ? 30 : 12;
  const opportunityGrant = isMember ? 7 : 3;
  const playbackMax = isMember ? 30 : 0;
  const playbackGrant = isMember ? 7 : 0;

  let opportunityBalance = numberValue(
    data.voiceOpportunityBalance,
    opportunityGrant,
  );
  let playbackBalance = numberValue(
    data.voicePlaybackBalance,
    playbackGrant,
  );

  const lastRefill = dateFromValue(data.lastVoiceBudgetRefillAt);
  const elapsed = weeksElapsed(lastRefill, now);

  if (elapsed > 0) {
    opportunityBalance = Math.min(
      opportunityMax,
      opportunityBalance + elapsed * opportunityGrant,
    );

    playbackBalance = Math.min(
      playbackMax,
      playbackBalance + elapsed * playbackGrant,
    );
  }

  return {
    opportunityBalance,
    opportunityMax,
    opportunityGrant,
    playbackBalance,
    playbackMax,
    playbackGrant,
    elapsedWeeks: elapsed,
  };
}

function hoursSince(value, now) {
  const date = dateFromValue(value);
  if (!date) return Number.POSITIVE_INFINITY;
  return (now.getTime() - date.getTime()) / 3600000;
}

function emptyVoiceEvent(reason, candidate = null) {
  return {
    show: false,
    reason,
    candidateScore: candidate?.score || 0,
    category: candidate?.category || 'none',
  };
}

async function directVoiceEvent({
  userId,
  message,
  reply,
  recentMessages = [],
} = {}) {
  if (!userId) {
    return emptyVoiceEvent('missing_user_id');
  }

  const candidate = evaluateVoiceCandidate({
    message,
    reply,
    recentMessages,
  });

  const db = ensureFirebaseAdmin();
  const ref = db.collection('users').doc(String(userId));
  const adminRef = db.collection('admins').doc(String(userId));
  const now = new Date();

  let decision = null;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const adminSnapshot = await transaction.get(adminRef);
    const data = snapshot.data() || {};
    const adminData = adminSnapshot.data() || {};
    const adminRole = String(adminData.role || '').trim().toLowerCase();
    const internalUnlimited =
      adminSnapshot.exists &&
      adminData.active === true &&
      (adminRole === 'owner' || adminRole === 'admin');

    const tier = internalUnlimited ? 'premium' : normalizeTier(data);
    const isMember = internalUnlimited || isMemberTier(tier);
    const balances = internalUnlimited
      ? {
          opportunityBalance: 999999,
          opportunityMax: 999999,
          opportunityGrant: 999999,
          playbackBalance: 999999,
          playbackMax: 999999,
          playbackGrant: 999999,
          elapsedWeeks: 0,
        }
      : applyWeeklyRefill(data, now, isMember);

    const state = String(data.voiceState || 'idle');
    let followUpRemaining = numberValue(
      data.voiceFollowUpRemaining,
      0,
    );

    const baseUpdate = {
      membershipTier: tier,
      voiceOpportunityMax: balances.opportunityMax,
      voiceOpportunityWeeklyGrant: balances.opportunityGrant,
      voicePlaybackMax: balances.playbackMax,
      voicePlaybackWeeklyGrant: balances.playbackGrant,
      voiceOpportunityBalance: balances.opportunityBalance,
      voicePlaybackBalance: balances.playbackBalance,
      lastConversationAt: admin.firestore.FieldValue.serverTimestamp(),
      voiceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      voiceSchemaVersion: 1,
      ...(internalUnlimited
        ? {
            internalAccess: true,
            internalUnlimited: true,
            adminRole,
          }
        : {}),
    };

    if (balances.elapsedWeeks > 0) {
      baseUpdate.lastVoiceBudgetRefillAt =
        admin.firestore.FieldValue.serverTimestamp();
    }

    // Waiting for the user's reaction after the first Whisper.
    if (state === 'waiting_reply') {
      if (String(message || '').trim().length >= 2) {
        followUpRemaining = Math.max(0, followUpRemaining - 1);
      }

      if (followUpRemaining > 0) {
        transaction.set(
          ref,
          {
            ...baseUpdate,
            voiceFollowUpRemaining: followUpRemaining,
          },
          { merge: true },
        );

        decision = emptyVoiceEvent(
          'waiting_follow_up_round',
          candidate,
        );
        return;
      }

      if (
        !candidate.unsafe &&
        candidate.score >= FOLLOW_UP_SCORE_MIN &&
        (internalUnlimited || balances.opportunityBalance > 0) &&
        (internalUnlimited || !isMember || balances.playbackBalance > 0)
      ) {
        const nextOpportunity = internalUnlimited
          ? balances.opportunityBalance
          : Math.max(0, balances.opportunityBalance - 1);
        const nextPlayback = internalUnlimited
          ? balances.playbackBalance
          : isMember
            ? Math.max(0, balances.playbackBalance - 1)
            : balances.playbackBalance;

        transaction.set(
          ref,
          {
            ...baseUpdate,
            voiceOpportunityBalance: nextOpportunity,
            voicePlaybackBalance: nextPlayback,
            voiceState: 'cooldown',
            voiceFollowUpRemaining: 0,
            lastVoiceAt:
              admin.firestore.FieldValue.serverTimestamp(),
            voiceEventsThisWeek:
              admin.firestore.FieldValue.increment(1),
            voiceEventsThisMonth:
              admin.firestore.FieldValue.increment(1),
          },
          { merge: true },
        );

        decision = {
          show: true,
          phase: 'follow_up',
          locked: !isMember,
          member: isMember,
          internalUnlimited,
          candidateScore: candidate.score,
          category: candidate.category,
          reason: 'follow_up_approved',
          remainingOpportunity: nextOpportunity,
          remainingPlayback: nextPlayback,
        };
        return;
      }

      transaction.set(
        ref,
        {
          ...baseUpdate,
          voiceState: 'idle',
          voiceFollowUpRemaining: 0,
        },
        { merge: true },
      );

      decision = emptyVoiceEvent(
        'follow_up_not_worthy',
        candidate,
      );
      return;
    }

    if (!candidate.candidate) {
      transaction.set(ref, baseUpdate, { merge: true });
      decision = emptyVoiceEvent(
        candidate.reason || 'candidate_rejected',
        candidate,
      );
      return;
    }

    if (
      !internalUnlimited &&
      hoursSince(data.lastVoiceAt, now) < COOLDOWN_HOURS
    ) {
      transaction.set(ref, baseUpdate, { merge: true });
      decision = emptyVoiceEvent('cooldown', candidate);
      return;
    }

    if (!internalUnlimited && balances.opportunityBalance <= 0) {
      transaction.set(ref, baseUpdate, { merge: true });
      decision = emptyVoiceEvent(
        'opportunity_budget_empty',
        candidate,
      );
      return;
    }

    if (!internalUnlimited && isMember && balances.playbackBalance <= 0) {
      transaction.set(ref, baseUpdate, { merge: true });
      decision = emptyVoiceEvent(
        'playback_budget_empty',
        candidate,
      );
      return;
    }

    const nextOpportunity = internalUnlimited
      ? balances.opportunityBalance
      : Math.max(0, balances.opportunityBalance - 1);
    const nextPlayback = internalUnlimited
      ? balances.playbackBalance
      : isMember
        ? Math.max(0, balances.playbackBalance - 1)
        : balances.playbackBalance;

    // A first Whisper may have a follow-up after 1 or 2 user turns.
    const followUpTurns = Math.random() < 0.55 ? 1 : 2;

    transaction.set(
      ref,
      {
        ...baseUpdate,
        voiceOpportunityBalance: nextOpportunity,
        voicePlaybackBalance: nextPlayback,
        voiceState: 'waiting_reply',
        voiceFollowUpRemaining: followUpTurns,
        lastVoiceAt: admin.firestore.FieldValue.serverTimestamp(),
        voiceEventsThisWeek:
          admin.firestore.FieldValue.increment(1),
        voiceEventsThisMonth:
          admin.firestore.FieldValue.increment(1),
      },
      { merge: true },
    );

    decision = {
      show: true,
      phase: 'first',
      locked: !isMember,
      member: isMember,
      internalUnlimited,
      candidateScore: candidate.score,
      category: candidate.category,
      reason: 'first_whisper_approved',
      followUpAfterTurns: followUpTurns,
      remainingOpportunity: nextOpportunity,
      remainingPlayback: nextPlayback,
    };
  });

  if (!decision?.show) {
    return decision || emptyVoiceEvent('no_decision', candidate);
  }

  const voiceText = buildVoiceLine({
    message,
    reply,
    phase: decision.phase,
  });

  // Free users receive a real locked Whisper bubble but no audio is generated.
  if (decision.locked) {
    return {
      ...decision,
      title: 'Akasha Whisper',
      voiceTextPreview: '',
      audioBase64: '',
      contentType: '',
      upgradeRequired: true,
    };
  }

  try {
    const audio = await generateAkashaVoice(voiceText);

    return {
      ...decision,
      title: 'Akasha Whisper',
      voiceTextPreview: voiceText,
      audioBase64: audio.buffer.toString('base64'),
      contentType: audio.contentType || 'audio/mpeg',
      audioBytes: audio.audioBytes,
      latencyMs: audio.latencyMs,
      upgradeRequired: false,
    };
  } catch (error) {
    // Chat must never fail because ElevenLabs is unavailable.
    console.error('[AKASHA_VOICE_DIRECTOR] generation failed', {
      code: error.code,
      status: error.status,
      message: error.message,
    });

    return {
      show: false,
      reason: 'voice_generation_failed',
      candidateScore: candidate.score,
      category: candidate.category,
    };
  }
}

module.exports = {
  directVoiceEvent,
};
