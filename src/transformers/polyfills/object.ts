/**
 * Object polyfills for Safari 9
 */
export const objectPolyfill = `
  // Object.assign polyfill (Safari 9 has it but just in case)
  if (!Object.assign) {
    Object.assign = function(target) {
      if (target == null) throw new TypeError('Cannot convert undefined or null to object');
      var to = Object(target);
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i];
        if (source != null) {
          for (var key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
              to[key] = source[key];
            }
          }
        }
      }
      return to;
    };
  }
  
  // Object.entries polyfill
  if (!Object.entries) {
    Object.entries = function(obj) {
      var entries = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          entries.push([key, obj[key]]);
        }
      }
      return entries;
    };
  }
  
  // Object.values polyfill
  if (!Object.values) {
    Object.values = function(obj) {
      var values = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          values.push(obj[key]);
        }
      }
      return values;
    };
  }
  
  // Object.getOwnPropertyDescriptors polyfill
  if (!Object.getOwnPropertyDescriptors) {
    Object.getOwnPropertyDescriptors = function(obj) {
      var descriptors = {};
      var keys = Object.getOwnPropertyNames(obj);
      for (var i = 0; i < keys.length; i++) {
        descriptors[keys[i]] = Object.getOwnPropertyDescriptor(obj, keys[i]);
      }
      return descriptors;
    };
  }
  
  // Object.fromEntries polyfill
  if (!Object.fromEntries) {
    Object.fromEntries = function(iterable) {
      return Array.from(iterable).reduce(function(obj, entry) {
        obj[entry[0]] = entry[1];
        return obj;
      }, {});
    };
  }
`;
