/**
 * PAC File Module
 * Provides proxy auto-configuration file generation
 */

export {
  generateSocks5Pac,
  generateHttpPac,
  generateCombinedPac,
  generateSelectivePac,
  getAllPacFiles,
  getLocalIpAddress,
  type PacFileInfo
} from './generator.js';
