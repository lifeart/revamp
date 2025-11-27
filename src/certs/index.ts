/**
 * Certificate generation for HTTPS interception
 * Creates CA certificate and per-domain certificates on the fly
 */

import forge from 'node-forge';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config/index.js';

interface CertificatePair {
  key: string;
  cert: string;
}

// Cache for generated domain certificates
const certCache = new Map<string, CertificatePair>();

let caKey: forge.pki.rsa.PrivateKey | null = null;
let caCert: forge.pki.Certificate | null = null;

function ensureCertDir(): void {
  const config = getConfig();
  if (!existsSync(config.certDir)) {
    mkdirSync(config.certDir, { recursive: true });
  }
}

/**
 * Generate the CA (Certificate Authority) certificate
 * This needs to be installed on the client device to trust our proxy
 */
export function generateCA(): CertificatePair {
  const config = getConfig();
  ensureCertDir();
  
  const caKeyPath = join(config.certDir, config.caKeyFile);
  const caCertPath = join(config.certDir, config.caCertFile);
  
  // Check if CA already exists
  if (existsSync(caKeyPath) && existsSync(caCertPath)) {
    const keyPem = readFileSync(caKeyPath, 'utf-8');
    const certPem = readFileSync(caCertPath, 'utf-8');
    
    caKey = forge.pki.privateKeyFromPem(keyPem);
    caCert = forge.pki.certificateFromPem(certPem);
    
    return { key: keyPem, cert: certPem };
  }
  
  console.log('🔐 Generating new CA certificate...');
  
  // Generate new CA
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  
  const attrs = [
    { name: 'commonName', value: 'Revamp Proxy CA' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'Revamp' },
    { name: 'organizationalUnitName', value: 'Revamp Proxy' },
  ];
  
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true,
      critical: true,
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      cRLSign: true,
      critical: true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);
  
  // Self-sign the CA certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());
  
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  
  // Save to disk
  writeFileSync(caKeyPath, keyPem);
  writeFileSync(caCertPath, certPem);
  
  caKey = keys.privateKey;
  caCert = cert;
  
  console.log(`✅ CA certificate saved to: ${caCertPath}`);
  console.log('📱 Install this certificate on your device to trust the proxy');
  
  return { key: keyPem, cert: certPem };
}

/**
 * Generate a certificate for a specific domain, signed by our CA
 */
export function generateDomainCert(domain: string): CertificatePair {
  // Check cache first
  const cached = certCache.get(domain);
  if (cached) {
    return cached;
  }
  
  // Ensure CA is loaded
  if (!caKey || !caCert) {
    generateCA();
  }
  
  if (!caKey || !caCert) {
    throw new Error('CA not initialized');
  }
  
  // Generate domain certificate
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  
  const attrs = [
    { name: 'commonName', value: domain },
    { name: 'organizationName', value: 'Revamp' },
  ];
  
  cert.setSubject(attrs);
  cert.setIssuer(caCert.subject.attributes);
  
  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: domain }, // DNS
        { type: 2, value: `*.${domain}` }, // Wildcard
      ],
    },
  ]);
  
  // Sign with CA key
  cert.sign(caKey, forge.md.sha256.create());
  
  const result: CertificatePair = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
  
  // Cache the certificate
  certCache.set(domain, result);
  
  return result;
}

/**
 * Get the CA certificate for installation on client devices
 */
export function getCACert(): string {
  if (!caCert) {
    generateCA();
  }
  
  if (!caCert) {
    throw new Error('CA not initialized');
  }
  
  return forge.pki.certificateToPem(caCert);
}

/**
 * Clear the certificate cache
 */
export function clearCertCache(): void {
  certCache.clear();
}
