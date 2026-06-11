/**
 * Hello World example plugin.
 *
 * Adds an `x-revamp-hello` response header to every response that flows
 * through the proxy. Demonstrates the minimal shape of a Revamp plugin:
 * an ESM default export with optional lifecycle methods and a hook.
 */

const HEADER_NAME = 'x-revamp-hello';

export default {
  async activate(context) {
    context.registerHook(
      'response:post',
      async (response) => {
        const config = context.getPluginConfig();
        const value =
          typeof config.headerValue === 'string' ? config.headerValue : 'world';

        return {
          continue: true,
          value: {
            headers: {
              ...response.responseHeaders,
              [HEADER_NAME]: value,
            },
          },
        };
      },
      0,
    );
  },

  async deactivate(context) {
    context.unregisterHook('response:post');
  },
};
