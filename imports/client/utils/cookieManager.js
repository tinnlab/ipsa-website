// Cookie management utilities with consent checking
import Cookies from 'js-cookie';

const CONSENT_KEY = 'cookie_consent';

/**
 * Check if user has given cookie consent
 * @returns {boolean} true if consent given, false otherwise
 */
export function hasConsent() {
    const consent = localStorage.getItem(CONSENT_KEY);
    return consent === 'accepted';
}

/**
 * Set cookie consent preference
 * @param {boolean} accepted - true if user accepts cookies, false otherwise
 */
export function setConsent(accepted) {
    localStorage.setItem(CONSENT_KEY, accepted ? 'accepted' : 'declined');
}

/**
 * Check if consent has been asked (user has made a choice)
 * @returns {boolean} true if user has made a choice, false if not asked yet
 */
export function hasConsentBeenAsked() {
    return localStorage.getItem(CONSENT_KEY) !== null;
}

/**
 * Set a cookie (only if user has consented)
 * @param {string} name - Cookie name
 * @param {string} value - Cookie value
 * @param {object} options - Cookie options (same as js-cookie)
 * @returns {boolean} true if cookie was set, false if consent not given
 */
export function setCookie(name, value, options = {}) {
    if (hasConsent()) {
        Cookies.set(name, value, options);
        return true;
    }
    console.warn(`Cookie "${name}" not set: User has not consented to cookies`);
    return false;
}

/**
 * Get a cookie (reading cookies is allowed without consent)
 * @param {string} name - Cookie name
 * @returns {string|undefined} Cookie value
 */
export function getCookie(name) {
    return Cookies.get(name);
}

/**
 * Remove a cookie
 * @param {string} name - Cookie name
 * @param {object} options - Cookie options
 */
export function removeCookie(name, options = {}) {
    Cookies.remove(name, options);
}

/**
 * Clear all cookies (use with caution)
 */
export function clearAllCookies() {
    const allCookies = Cookies.get();
    Object.keys(allCookies).forEach(cookieName => {
        Cookies.remove(cookieName);
    });
}
