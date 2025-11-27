/**
 * URLSearchParams polyfill for Safari 9
 */
export const urlSearchParamsPolyfill = `
  // URLSearchParams polyfill (basic)
  if (typeof URLSearchParams === 'undefined') {
    window.URLSearchParams = function(init) {
      var params = {};
      if (typeof init === 'string') {
        init = init.replace(/^\\?/, '');
        var pairs = init.split('&');
        for (var i = 0; i < pairs.length; i++) {
          var pair = pairs[i].split('=');
          var key = decodeURIComponent(pair[0] || '');
          var value = decodeURIComponent(pair[1] || '');
          if (key) params[key] = value;
        }
      }
      this._params = params;
    };
    URLSearchParams.prototype.get = function(name) {
      return this._params[name] || null;
    };
    URLSearchParams.prototype.set = function(name, value) {
      this._params[name] = String(value);
    };
    URLSearchParams.prototype.has = function(name) {
      return name in this._params;
    };
    URLSearchParams.prototype.delete = function(name) {
      delete this._params[name];
    };
    URLSearchParams.prototype.toString = function() {
      var pairs = [];
      for (var key in this._params) {
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(this._params[key]));
      }
      return pairs.join('&');
    };
  }
`;
