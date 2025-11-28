/**
 * PAC Index Module Tests
 * Tests for re-exported functions from PAC index
 */

import { describe, it, expect } from 'vitest';
import {
  generateSocks5Pac,
  generateHttpPac,
  generateCombinedPac,
  generateSelectivePac,
  getAllPacFiles,
  getLocalIpAddress,
  type PacFileInfo,
} from './index.js';

describe('pac index exports', () => {
  it('should export generateSocks5Pac function', () => {
    expect(typeof generateSocks5Pac).toBe('function');
  });

  it('should export generateHttpPac function', () => {
    expect(typeof generateHttpPac).toBe('function');
  });

  it('should export generateCombinedPac function', () => {
    expect(typeof generateCombinedPac).toBe('function');
  });

  it('should export generateSelectivePac function', () => {
    expect(typeof generateSelectivePac).toBe('function');
  });

  it('should export getAllPacFiles function', () => {
    expect(typeof getAllPacFiles).toBe('function');
  });

  it('should export getLocalIpAddress function', () => {
    expect(typeof getLocalIpAddress).toBe('function');
  });

  describe('exported functions work correctly', () => {
    it('generateSocks5Pac should return valid PAC file', () => {
      const pac = generateSocks5Pac();
      expect(pac).toContain('FindProxyForURL');
    });

    it('generateHttpPac should return valid PAC file', () => {
      const pac = generateHttpPac();
      expect(pac).toContain('FindProxyForURL');
    });

    it('generateCombinedPac should return valid PAC file', () => {
      const pac = generateCombinedPac();
      expect(pac).toContain('FindProxyForURL');
    });

    it('generateSelectivePac should return valid PAC file', () => {
      const pac = generateSelectivePac(['example.com'], 'SOCKS5 localhost:1080');
      expect(pac).toContain('FindProxyForURL');
      expect(pac).toContain('example.com');
    });

    it('getAllPacFiles should return array of PAC file info', () => {
      const files = getAllPacFiles();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toHaveProperty('filename');
      expect(files[0]).toHaveProperty('content');
      expect(files[0]).toHaveProperty('description');
      expect(files[0]).toHaveProperty('mimeType');
    });

    it('getLocalIpAddress should return valid IP address', () => {
      const ip = getLocalIpAddress();
      expect(typeof ip).toBe('string');
      // Should be an IP address format or localhost
      expect(ip.length).toBeGreaterThan(0);
    });
  });
});
