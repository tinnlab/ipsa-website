// Whether the homepage shows its video tutorial, and which video.
//
// The shipped tutorial demonstrates the previous product (AIPA) and was hidden rather than
// re-recorded. Hiding it by deleting or commenting out the JSX would have made showing it again a
// code change; this reads a `public` setting instead, so both "show it again" and "point it at a new
// video" are settings edits.
//
// DEFAULT OFF and fail-safe: a deployment whose settings.json predates this key, or that sets
// `enabled` to anything other than the boolean `true`, or that enables it without giving an id,
// simply gets no video section. There is no way to end up with an empty player or a broken embed.

const EMBED_BASE = 'https://www.youtube.com/embed/';

/**
 * @param {object} settingsPublic - Meteor.settings.public (may be undefined).
 * @returns {{youtubeId: string, embedUrl: string} | null} null means "render nothing".
 */
export function resolveVideoTutorial(settingsPublic) {
    const config = settingsPublic && settingsPublic.videoTutorial;
    if (!config || typeof config !== 'object') return null;
    // Strict === true: a stray truthy value in a hand-edited settings file must not turn the
    // section back on, the same rule `neverExpires` follows in shareLink.js.
    if (config.enabled !== true) return null;
    if (typeof config.youtubeId !== 'string') return null;
    const youtubeId = config.youtubeId.trim();
    if (youtubeId.length === 0) return null;
    return { youtubeId, embedUrl: `${EMBED_BASE}${youtubeId}` };
}
