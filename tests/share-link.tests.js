import assert from "assert";
import {
    SHARE_STATUS,
    shareStatus,
    isShareUsable,
    isValidExpiryDays,
    expiryFromDays,
    formatExpiresIn,
    shareUrl,
    DAY_MS,
    MIN_EXPIRY_DAYS,
    MAX_EXPIRY_DAYS,
} from "../imports/utils/shareLink";

const NOW = new Date("2026-01-15T12:00:00Z").getTime();
const active = {expiresAt: new Date(NOW + 3 * DAY_MS)};

describe("shareStatus", function () {
    it("is Active while the expiry is in the future", function () {
        assert.strictEqual(shareStatus(active, NOW), SHARE_STATUS.ACTIVE);
    });

    it("is Expired once the expiry has passed", function () {
        assert.strictEqual(shareStatus({expiresAt: new Date(NOW - 1)}, NOW), SHARE_STATUS.EXPIRED);
    });

    it("is Expired exactly at the boundary (expiry is not inclusive)", function () {
        assert.strictEqual(shareStatus({expiresAt: new Date(NOW)}, NOW), SHARE_STATUS.EXPIRED);
    });

    // Revocation is the owner's kill switch, so it must win over any expiry value — including one
    // in the future, and including a later "extend".
    it("is Revoked regardless of expiry once revoked", function () {
        assert.strictEqual(
            shareStatus({expiresAt: new Date(NOW + 10 * DAY_MS), revokedAt: new Date(NOW)}, NOW),
            SHARE_STATUS.REVOKED
        );
    });

    // Fail closed: a malformed or absent expiry must not read as "never expires".
    it("treats a missing or unparseable expiry as Expired, not eternal", function () {
        assert.strictEqual(shareStatus({}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(shareStatus({expiresAt: null}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(shareStatus({expiresAt: "nonsense"}, NOW), SHARE_STATUS.EXPIRED);
    });

    it("treats a missing share as Revoked", function () {
        assert.strictEqual(shareStatus(null, NOW), SHARE_STATUS.REVOKED);
        assert.strictEqual(shareStatus(undefined, NOW), SHARE_STATUS.REVOKED);
    });
});

describe("isShareUsable (the gate the import path uses)", function () {
    it("accepts only an active share", function () {
        assert.strictEqual(isShareUsable(active, NOW), true);
        assert.strictEqual(isShareUsable({expiresAt: new Date(NOW - 1)}, NOW), false);
        assert.strictEqual(isShareUsable({...active, revokedAt: new Date(NOW)}, NOW), false);
        assert.strictEqual(isShareUsable(null, NOW), false);
        assert.strictEqual(isShareUsable({}, NOW), false);
    });
});

describe("isValidExpiryDays", function () {
    it("accepts whole days within the allowed range", function () {
        assert.strictEqual(isValidExpiryDays(MIN_EXPIRY_DAYS), true);
        assert.strictEqual(isValidExpiryDays(7), true);
        assert.strictEqual(isValidExpiryDays(MAX_EXPIRY_DAYS), true);
    });

    it("rejects out-of-range, fractional and non-numeric values", function () {
        assert.strictEqual(isValidExpiryDays(0), false);
        assert.strictEqual(isValidExpiryDays(-1), false);
        assert.strictEqual(isValidExpiryDays(MAX_EXPIRY_DAYS + 1), false);
        assert.strictEqual(isValidExpiryDays(1.5), false);
        assert.strictEqual(isValidExpiryDays("7"), false);
        assert.strictEqual(isValidExpiryDays(null), false);
        assert.strictEqual(isValidExpiryDays(undefined), false);
        assert.strictEqual(isValidExpiryDays(NaN), false);
        assert.strictEqual(isValidExpiryDays(Infinity), false);
    });
});

describe("expiryFromDays", function () {
    it("computes the expiry from the supplied clock, not the ambient one", function () {
        assert.strictEqual(expiryFromDays(2, NOW).getTime(), NOW + 2 * DAY_MS);
    });
});

describe("formatExpiresIn", function () {
    it("reports whole days when more than a day remains", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 3 * DAY_MS)}, NOW), "3 days");
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + DAY_MS)}, NOW), "1 day");
    });

    it("falls back to hours, then minutes", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 5 * 60 * 60 * 1000)}, NOW), "5 hours");
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 90 * 1000)}, NOW), "1 minute");
    });

    // Never round down to "0 minutes" for a link that is still usable.
    it("never reports zero for a share that is still active", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW + 1000)}, NOW), "1 minute");
    });

    it("reports the status itself when not active", function () {
        assert.strictEqual(formatExpiresIn({expiresAt: new Date(NOW - 1)}, NOW), SHARE_STATUS.EXPIRED);
        assert.strictEqual(formatExpiresIn({...active, revokedAt: new Date(NOW)}, NOW), SHARE_STATUS.REVOKED);
    });
});

describe("shareUrl", function () {
    it("builds the import link from origin and prefix", function () {
        assert.strictEqual(shareUrl("abc", "https://app.example.com"), "https://app.example.com/import/abc");
    });

    it("honours a deployment path prefix", function () {
        assert.strictEqual(shareUrl("abc", "https://x.io", "/cpa"), "https://x.io/cpa/import/abc");
    });

    it("tolerates an empty or missing prefix", function () {
        assert.strictEqual(shareUrl("abc", "https://x.io", ""), "https://x.io/import/abc");
        assert.strictEqual(shareUrl("abc", "https://x.io", undefined), "https://x.io/import/abc");
    });
});
