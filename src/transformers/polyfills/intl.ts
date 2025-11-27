/**
 * Basic Intl polyfill for Safari 9
 * Provides simplified DateTimeFormat and NumberFormat
 */
export const intlPolyfill = `
  // Basic Intl polyfill for Safari 9
  (function() {
    'use strict';

    if (typeof Intl === 'undefined') {
      window.Intl = {};
    }

    // Basic DateTimeFormat polyfill
    if (!Intl.DateTimeFormat) {
      Intl.DateTimeFormat = function(locale, options) {
        this._locale = locale || 'en-US';
        this._options = options || {};
      };

      Intl.DateTimeFormat.prototype.format = function(date) {
        if (!(date instanceof Date)) {
          date = new Date(date);
        }

        var opts = this._options;
        var parts = [];

        // Build format based on options
        if (opts.weekday) {
          var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          var shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          parts.push(opts.weekday === 'short' ? shortDays[date.getDay()] : days[date.getDay()]);
        }

        if (opts.month || opts.day || opts.year) {
          var dateParts = [];

          if (opts.month) {
            var months = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
            var shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            if (opts.month === 'numeric') {
              dateParts.push(date.getMonth() + 1);
            } else if (opts.month === '2-digit') {
              dateParts.push(('0' + (date.getMonth() + 1)).slice(-2));
            } else if (opts.month === 'short') {
              dateParts.push(shortMonths[date.getMonth()]);
            } else {
              dateParts.push(months[date.getMonth()]);
            }
          }

          if (opts.day) {
            if (opts.day === '2-digit') {
              dateParts.push(('0' + date.getDate()).slice(-2));
            } else {
              dateParts.push(date.getDate());
            }
          }

          if (opts.year) {
            if (opts.year === '2-digit') {
              dateParts.push(String(date.getFullYear()).slice(-2));
            } else {
              dateParts.push(date.getFullYear());
            }
          }

          parts.push(dateParts.join('/'));
        }

        if (opts.hour || opts.minute || opts.second) {
          var timeParts = [];
          var hour = date.getHours();
          var suffix = '';

          if (opts.hour12) {
            suffix = hour >= 12 ? ' PM' : ' AM';
            hour = hour % 12 || 12;
          }

          if (opts.hour) {
            if (opts.hour === '2-digit') {
              timeParts.push(('0' + hour).slice(-2));
            } else {
              timeParts.push(hour);
            }
          }

          if (opts.minute) {
            if (opts.minute === '2-digit') {
              timeParts.push(('0' + date.getMinutes()).slice(-2));
            } else {
              timeParts.push(date.getMinutes());
            }
          }

          if (opts.second) {
            if (opts.second === '2-digit') {
              timeParts.push(('0' + date.getSeconds()).slice(-2));
            } else {
              timeParts.push(date.getSeconds());
            }
          }

          parts.push(timeParts.join(':') + suffix);
        }

        // Default format if no options
        if (parts.length === 0) {
          return date.toLocaleDateString();
        }

        return parts.join(' ');
      };

      Intl.DateTimeFormat.prototype.resolvedOptions = function() {
        return Object.assign({ locale: this._locale }, this._options);
      };

      Intl.DateTimeFormat.supportedLocalesOf = function(locales) {
        return Array.isArray(locales) ? locales : [locales];
      };
    }

    // Basic NumberFormat polyfill
    if (!Intl.NumberFormat) {
      Intl.NumberFormat = function(locale, options) {
        this._locale = locale || 'en-US';
        this._options = options || {};
      };

      Intl.NumberFormat.prototype.format = function(num) {
        var opts = this._options;
        var result = Number(num);

        // Handle style
        if (opts.style === 'percent') {
          result = result * 100;
        }

        // Handle decimal places
        var minFrac = opts.minimumFractionDigits || 0;
        var maxFrac = opts.maximumFractionDigits !== undefined ? opts.maximumFractionDigits :
                      (opts.style === 'currency' ? 2 : 3);

        result = result.toFixed(Math.min(Math.max(minFrac, 0), maxFrac));

        // Add thousand separators
        if (opts.useGrouping !== false) {
          var parts = result.split('.');
          parts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
          result = parts.join('.');
        }

        // Handle currency
        if (opts.style === 'currency' && opts.currency) {
          var symbols = {
            'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'CNY': '¥',
            'RUB': '₽', 'INR': '₹', 'BRL': 'R$', 'KRW': '₩'
          };
          var symbol = symbols[opts.currency] || opts.currency;
          if (opts.currencyDisplay === 'code') {
            symbol = opts.currency;
          }
          result = symbol + result;
        }

        // Handle percent
        if (opts.style === 'percent') {
          result = result + '%';
        }

        return result;
      };

      Intl.NumberFormat.prototype.resolvedOptions = function() {
        return Object.assign({ locale: this._locale }, this._options);
      };

      Intl.NumberFormat.supportedLocalesOf = function(locales) {
        return Array.isArray(locales) ? locales : [locales];
      };
    }

    // Basic PluralRules polyfill
    if (!Intl.PluralRules) {
      Intl.PluralRules = function(locale) {
        this._locale = locale || 'en';
      };

      Intl.PluralRules.prototype.select = function(n) {
        n = Math.abs(Number(n));
        if (n === 1) return 'one';
        return 'other';
      };

      Intl.PluralRules.prototype.resolvedOptions = function() {
        return { locale: this._locale };
      };

      Intl.PluralRules.supportedLocalesOf = function(locales) {
        return Array.isArray(locales) ? locales : [locales];
      };
    }
  })();
`;
