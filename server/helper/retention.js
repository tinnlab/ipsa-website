// Retention helpers moved to imports/utils/retention.js so they are ISOMORPHIC (importable from
// both client and server — the client Extend button and expiry badge need the same window/logic
// the server sweep uses). This file re-exports them so existing server-side imports
// (`server/helper/retention`) and the test suite keep working unchanged, and adds the server-only
// resolver for the operator-configurable retention window.
import { Meteor } from "meteor/meteor";
import { RETENTION_DEFAULT_DAYS, clampRetentionDays } from "/imports/utils/retention";

export * from "/imports/utils/retention";

// The effective study/file retention window (days), operator-configurable via
// Meteor.settings.private.dataRetentionDays, falling back to the built-in default. Server-only
// (reads Meteor.settings); the server threads this into study creation, Extend, and the legacy
// backfill so the setting is authoritative rather than dead config. The value is CLAMPED to a
// safe positive day count — a degenerate window (0/negative/NaN/non-numeric) would otherwise make
// every study immediately expired and hard-deleted by the sweep; such values are ignored (warn +
// fall back to the default) rather than trusted.
export const sessionExpiryDays = () => {
    const raw = Meteor.settings?.private?.dataRetentionDays;
    const days = clampRetentionDays(raw, RETENTION_DEFAULT_DAYS);
    if (raw != null && days !== Number(raw)) {
        console.warn(`[retention] ignoring out-of-range dataRetentionDays=${raw}; using ${RETENTION_DEFAULT_DAYS} days`);
    }
    return days;
};
