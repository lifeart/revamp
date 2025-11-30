/**
 * Stubs for blocked ad/analytics scripts
 * These define empty functions to prevent errors when blocked scripts are referenced
 * This should be injected FIRST, before any other scripts
 */
export const blockedScriptsStubs = `
  // Stubs for blocked ad/analytics scripts
  (function() {
    'use strict';

    // Yandex Metrika
    if (typeof window.ym === 'undefined') {
      window.ym = function() {};
    }
    if (typeof window.Ya === 'undefined') {
      window.Ya = {
        Metrika: function() { return { reachGoal: function() {}, hit: function() {}, params: function() {} }; },
        Metrika2: function() { return { reachGoal: function() {}, hit: function() {}, params: function() {} }; },
        adfoxCode: { create: function() {}, createAdaptive: function() {}, createScroll: function() {} }
      };
    }

    // Google Analytics (legacy ga.js)
    if (typeof window._gaq === 'undefined') {
      window._gaq = [];
      window._gaq.push = function() {};
    }

    // Google Analytics (Universal Analytics)
    if (typeof window.ga === 'undefined') {
      window.ga = function() {};
      window.ga.getAll = function() { return []; };
      window.ga.getByName = function() { return null; };
      window.ga.create = function() { return {}; };
    }

    // Google Tag Manager / gtag.js
    if (typeof window.gtag === 'undefined') {
      window.gtag = function() {};
    }
    if (typeof window.dataLayer === 'undefined') {
      window.dataLayer = [];
      window.dataLayer.push = function() {};
    }

    // Google Ads
    if (typeof window.googletag === 'undefined') {
      window.googletag = {
        cmd: [],
        defineSlot: function() { return this; },
        defineSizeMapping: function() { return this; },
        enableServices: function() {},
        display: function() {},
        pubads: function() {
          return {
            enableSingleRequest: function() {},
            collapseEmptyDivs: function() {},
            setTargeting: function() { return this; },
            addEventListener: function() {},
            refresh: function() {},
            clear: function() {}
          };
        },
        sizeMapping: function() {
          return {
            addSize: function() { return this; },
            build: function() { return []; }
          };
        },
        companionAds: function() { return { setRefreshUnfilledSlots: function() {} }; }
      };
    }

    // Facebook Pixel
    if (typeof window.fbq === 'undefined') {
      window.fbq = function() {};
      window.fbq.loaded = true;
      window.fbq.version = '2.0';
      window.fbq.queue = [];
    }
    if (typeof window._fbq === 'undefined') {
      window._fbq = window.fbq;
    }

    // Twitter/X Pixel
    if (typeof window.twq === 'undefined') {
      window.twq = function() {};
    }

    // VK Pixel
    if (typeof window.VK === 'undefined') {
      window.VK = {
        Retargeting: { Init: function() {}, Hit: function() {}, Event: function() {}, Add: function() {} },
        Goal: function() {},
        Widget: { Auth: function() {} }
      };
    }

    // Mail.ru Counter
    if (typeof window._tmr === 'undefined') {
      window._tmr = [];
      window._tmr.push = function() {};
    }

    // Amplitude
    if (typeof window.amplitude === 'undefined') {
      window.amplitude = {
        getInstance: function() {
          return {
            init: function() {},
            logEvent: function() {},
            setUserId: function() {},
            setUserProperties: function() {},
            track: function() {}
          };
        }
      };
    }

    // Mixpanel
    if (typeof window.mixpanel === 'undefined') {
      window.mixpanel = {
        init: function() {},
        track: function() {},
        identify: function() {},
        people: { set: function() {} },
        register: function() {}
      };
    }

    // Hotjar
    if (typeof window.hj === 'undefined') {
      window.hj = function() {};
      window.hj.q = [];
    }

    // Segment
    if (typeof window.analytics === 'undefined') {
      window.analytics = {
        track: function() {},
        identify: function() {},
        page: function() {},
        load: function() {},
        ready: function() {}
      };
    }

    // Criteo
    if (typeof window.criteo_q === 'undefined') {
      window.criteo_q = [];
      window.criteo_q.push = function() {};
    }

    // AdRoll
    if (typeof window.adroll === 'undefined') {
      window.adroll = { track: function() {}, identify: function() {} };
    }
    if (typeof window.__adroll === 'undefined') {
      window.__adroll = { record_user: function() {} };
    }

    // Comscore
    if (typeof window._comscore === 'undefined') {
      window._comscore = [];
    }
    if (typeof window.COMSCORE === 'undefined') {
      window.COMSCORE = { beacon: function() {} };
    }

    // Chartbeat
    if (typeof window._sf_async_config === 'undefined') {
      window._sf_async_config = {};
    }
    if (typeof window.pSUPERFLY === 'undefined') {
      window.pSUPERFLY = { virtualPage: function() {} };
    }

    // Tealium
    if (typeof window.utag === 'undefined') {
      window.utag = {
        link: function() {},
        view: function() {},
        track: function() {}
      };
    }

    // Generic ad blockers
    if (typeof window.__cmp === 'undefined') {
      window.__cmp = function(cmd, arg, callback) {
        if (callback) callback({ gdprApplies: false }, true);
      };
    }

    console.log('[Revamp] Blocked scripts stubs initialized');
  })();
`;
