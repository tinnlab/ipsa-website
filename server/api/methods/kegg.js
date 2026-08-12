import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import fetch from 'node-fetch';
import xmljs from 'xml-js';

const CACHE_TIMEOUT = 1000 * 60 * 60; // 1 hour

let kgmlCache = new Map();
let kgmlCacheTimeout = new Map();
let pngCache = new Map();
let pngCacheTimeout = new Map();

function setCache(cache, timeoutCache, key, value) {
    cache.set(key, value);
    if (timeoutCache.has(key)) clearTimeout(timeoutCache.get(key));

    timeoutCache.set(key, setTimeout(() => {
        cache.delete(key);
        timeoutCache.delete(key);
    }, CACHE_TIMEOUT));
}

Meteor.methods({
    async 'kegg.kgml'(pathwayId) {
        this.unblock();
        if (kgmlCache.has(pathwayId)) {
            return kgmlCache.get(pathwayId);
        }

        try {
            const res = await fetch(`http://rest.kegg.jp/get/${pathwayId}/kgml`);
            const kgml = await res.text();
            const xml = xmljs.xml2js(kgml);

            setCache(kgmlCache, kgmlCacheTimeout, pathwayId, xml);

            return xml;
        } catch (error) {
            throw new Meteor.Error('fetch-failed', 'Failed to fetch KGML data');
        }
    },
    async 'kegg.png'(url) {
        this.unblock();
        // The URL was fetched verbatim and the full response returned to the caller — a
        // server-side request forgery primitive reaching anything the server can route to,
        // including cloud metadata endpoints and internal services. Restrict it to what it is
        // actually for: KEGG pathway images.
        check(url, String);
        if (!/^https?:\/\/(www\.)?(rest\.)?kegg\.jp\//.test(url)) {
            throw new Meteor.Error('invalid-url', 'Only KEGG image URLs may be fetched.');
        }
        if (pngCache.has(url)) {
            return pngCache.get(url);
        }

        try {
            let resolution = 2;
            let res = await fetch(url.replace(/\.png$/, "@2x.png")).catch(async () => {
                resolution = 1;
                return fetch(url);
            });

            const buffer = await res.buffer();
            const png = buffer.toString('base64');

            const cachedData = { image: png, resolution };
            setCache(pngCache, pngCacheTimeout, url, cachedData);

            return cachedData;
        } catch (error) {
            throw new Meteor.Error('fetch-failed', 'Failed to fetch PNG data');
        }
    }
});
