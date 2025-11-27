// Type declarations for modules without types
declare module 'postcss-preset-env' {
  import { PluginCreator } from 'postcss';
  
  interface PostcssPresetEnvOptions {
    browsers?: string | string[];
    stage?: 0 | 1 | 2 | 3 | 4 | false;
    features?: Record<string, boolean | object>;
    autoprefixer?: {
      flexbox?: boolean | 'no-2009';
      grid?: boolean | 'autoplace' | 'no-autoplace';
    } | false;
    preserve?: boolean;
    enableClientSidePolyfills?: boolean;
  }
  
  const postcssPresetEnv: PluginCreator<PostcssPresetEnvOptions>;
  export default postcssPresetEnv;
}
