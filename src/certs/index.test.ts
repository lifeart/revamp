import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateCA,
  generateDomainCert,
  getCACert,
  clearCertCache,
} from './index.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Certificate Generation', () => {
  const testCertDir = join(tmpdir(), 'revamp-test-certs-' + Date.now());

  beforeEach(() => {
    resetConfig();
    updateConfig({
      certDir: testCertDir,
      caKeyFile: 'test-ca.key',
      caCertFile: 'test-ca.crt',
    });
    clearCertCache();

    // Clean up test directory
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true });
    }
  });

  afterEach(() => {
    clearCertCache();
    resetConfig();

    // Clean up test directory
    if (existsSync(testCertDir)) {
      rmSync(testCertDir, { recursive: true });
    }
  });

  describe('generateCA', () => {
    it('should generate a new CA certificate', () => {
      const { key, cert } = generateCA();

      expect(key).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(key).toContain('-----END RSA PRIVATE KEY-----');
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
      expect(cert).toContain('-----END CERTIFICATE-----');
    });

    it('should create certificate files', () => {
      generateCA();

      const keyPath = join(testCertDir, 'test-ca.key');
      const certPath = join(testCertDir, 'test-ca.crt');

      expect(existsSync(keyPath)).toBe(true);
      expect(existsSync(certPath)).toBe(true);
    });

    it('should reuse existing CA if files exist', () => {
      // Generate first CA
      const first = generateCA();

      // Generate again - should return same
      const second = generateCA();

      expect(first.cert).toBe(second.cert);
      expect(first.key).toBe(second.key);
    });

    it('should create cert directory if not exists', () => {
      expect(existsSync(testCertDir)).toBe(false);

      generateCA();

      expect(existsSync(testCertDir)).toBe(true);
    });
  });

  describe('generateDomainCert', () => {
    it('should generate domain certificate signed by CA', () => {
      const { key, cert } = generateDomainCert('example.com');

      expect(key).toContain('-----BEGIN RSA PRIVATE KEY-----');
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
    });

    it('should include domain in certificate', () => {
      const { cert } = generateDomainCert('example.com');

      // Certificate should be valid PEM format
      expect(cert).toContain('-----BEGIN CERTIFICATE-----');
      expect(cert).toContain('-----END CERTIFICATE-----');
    });

    it('should cache domain certificates', () => {
      const first = generateDomainCert('example.com');
      const second = generateDomainCert('example.com');

      // Should return same cached cert
      expect(first.cert).toBe(second.cert);
      expect(first.key).toBe(second.key);
    });

    it('should generate different certs for different domains', () => {
      const cert1 = generateDomainCert('example.com');
      const cert2 = generateDomainCert('test.org');

      expect(cert1.cert).not.toBe(cert2.cert);
      expect(cert1.key).not.toBe(cert2.key);
    });

    it('should auto-initialize CA if not done', () => {
      // Don't call generateCA first
      const { cert } = generateDomainCert('example.com');

      expect(cert).toContain('-----BEGIN CERTIFICATE-----');

      // CA should now be initialized (getCACert will work)
      const caCert = getCACert();
      expect(caCert).toContain('-----BEGIN CERTIFICATE-----');
    });
  });

  describe('getCACert', () => {
    it('should return CA certificate in PEM format', () => {
      generateCA();
      const caCert = getCACert();

      expect(caCert).toContain('-----BEGIN CERTIFICATE-----');
      expect(caCert).toContain('-----END CERTIFICATE-----');
    });

    it('should auto-generate CA if not exists', () => {
      const caCert = getCACert();

      expect(caCert).toContain('-----BEGIN CERTIFICATE-----');
    });

    it('should return same cert as generateCA', () => {
      const { cert } = generateCA();
      const caCert = getCACert();

      expect(caCert).toBe(cert);
    });
  });

  describe('clearCertCache', () => {
    it('should clear the certificate cache', () => {
      // Generate some domain certs to populate cache
      const first = generateDomainCert('example.com');

      clearCertCache();

      // Next call should generate new cert
      const second = generateDomainCert('example.com');

      // Keys should be different (new keypair generated)
      expect(first.key).not.toBe(second.key);
    });

    it('should not affect CA certificate', () => {
      const { cert: caCert } = generateCA();

      clearCertCache();

      // Domain cert cache cleared, but CA still on disk
      const caCert2 = getCACert();
      expect(caCert2).toBe(caCert);
    });
  });
});
