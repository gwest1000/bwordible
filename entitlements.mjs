// Billing will supply verified expiry times. Progress backups carry no purchase rights.
export const TRIAL_DAYS = 30;

export function getAccess({ premiumUntil = 0, trialEndsAt = 0, testing = false } = {}, now = Date.now()) {
  const premium = testing || premiumUntil > now || trialEndsAt > now;
  return { premium, archive: premium, detailedStats: premium, showAds: !premium };
}

export function getGuessAllowance(length, access, progress) {
  // Legacy saves used length + 2. Preserve their rules and every started game's limit.
  return progress?.maxGuesses ?? (progress ? length + 2 : length + (access.premium ? 2 : 0));
}
