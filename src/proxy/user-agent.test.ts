import { describe, it, expect } from 'vitest';
import { SPOOFED_USER_AGENT, spoofUserAgent } from './user-agent.js';
import { type RevampConfig } from '../config/index.js';

describe('SPOOFED_USER_AGENT', () => {
  it('should be a Chrome user agent', () => {
    expect(SPOOFED_USER_AGENT).toContain('Chrome');
    expect(SPOOFED_USER_AGENT).toContain('Mozilla/5.0');
  });
});

describe('spoofUserAgent', () => {
  const mockConfig = {
    spoofUserAgent: true,
  } as unknown as RevampConfig;

  it('should replace user-agent when spoofing is enabled', () => {
    const headers: Record<string, string | string[] | undefined> = {
      'user-agent': 'Safari/9.0',
    };

    spoofUserAgent(headers, mockConfig);

    expect(headers['user-agent']).toBe(SPOOFED_USER_AGENT);
  });

  it('should not add user-agent if not present', () => {
    const headers: Record<string, string | string[] | undefined> = {};

    spoofUserAgent(headers, mockConfig);

    expect(headers['user-agent']).toBeUndefined();
  });

  it('should not replace when spoofing is disabled', () => {
    const configNoSpoof = { ...mockConfig, spoofUserAgent: false };
    const headers: Record<string, string | string[] | undefined> = {
      'user-agent': 'Safari/9.0',
    };

    spoofUserAgent(headers, configNoSpoof);

    expect(headers['user-agent']).toBe('Safari/9.0');
  });
});
