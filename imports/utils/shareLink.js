// Pure helpers for share links: status, expiry and the copyable URL. Kept free of Meteor and the
// database so the rules are unit-testable, following the same convention as imports/utils/retention.js.

export const SHARE_MODES = ['results', 'full'];

export const SHARE_STATUS = {
    ACTIVE: 'Active',
    EXPIRED: 'Expired',
    REVOKED: 'Revoked',
};

// A share is usable only while it is active. Revocation is explicit and wins over the clock, so a
// revoked link never comes back even if its expiry is later extended.
export const shareStatus = (share, nowMs) => {
    if (!share) return SHARE_STATUS.REVOKED;
    if (share.revokedAt) return SHARE_STATUS.REVOKED;
    const expiresMs = share.expiresAt ? new Date(share.expiresAt).getTime() : NaN;
    // A share with no usable expiry is treated as expired rather than eternal — failing closed.
    if (!Number.isFinite(expiresMs)) return SHARE_STATUS.EXPIRED;
    return expiresMs > nowMs ? SHARE_STATUS.ACTIVE : SHARE_STATUS.EXPIRED;
};

export const isShareUsable = (share, nowMs) => shareStatus(share, nowMs) === SHARE_STATUS.ACTIVE;

export const DAY_MS = 24 * 60 * 60 * 1000;

// Expiry is expressed to the user in whole days. Bounded so a link cannot be created that outlives
// the study it points at, and so "never expires" is not expressible by accident.
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 90;

export const isValidExpiryDays = (days) =>
    Number.isInteger(days) && days >= MIN_EXPIRY_DAYS && days <= MAX_EXPIRY_DAYS;

export const expiryFromDays = (days, nowMs) => new Date(nowMs + days * DAY_MS);

// Human-readable remaining time for the owner's list of links.
export const formatExpiresIn = (share, nowMs) => {
    const status = shareStatus(share, nowMs);
    if (status !== SHARE_STATUS.ACTIVE) return status;
    const remaining = new Date(share.expiresAt).getTime() - nowMs;
    const days = Math.floor(remaining / DAY_MS);
    if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
    const minutes = Math.max(1, Math.floor(remaining / (60 * 1000)));
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
};

// The link handed to the recipient. Built from the app's own origin and urlPrefix so it works
// behind the deployment's path prefix.
export const shareUrl = (shareId, origin, urlPrefix = '') =>
    `${origin}${urlPrefix || ''}/import/${shareId}`;
