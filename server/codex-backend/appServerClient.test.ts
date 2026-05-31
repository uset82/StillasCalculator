// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  applyAccountNotification,
  isDeviceCodeSettingsError,
  parseAccountReadResult,
  parseDeviceLoginStartResult,
} from './appServerClient';

describe('Codex app-server auth parsing', () => {
  it('parses authenticated ChatGPT account/read responses', () => {
    expect(
      parseAccountReadResult({
        account: {
          type: 'chatgpt',
          email: 'user@example.com',
          planType: 'plus',
        },
        requiresOpenaiAuth: true,
      }),
    ).toEqual({
      authenticated: true,
      email: 'user@example.com',
      planType: 'plus',
      authMode: 'chatgpt',
    });
  });

  it('does not treat API-key auth as a ChatGPT account session', () => {
    expect(
      parseAccountReadResult({
        account: { type: 'apiKey' },
        requiresOpenaiAuth: true,
      }),
    ).toEqual({
      authenticated: false,
      email: null,
      planType: null,
      authMode: 'apiKey',
    });
  });

  it('parses ChatGPT device-code login start responses', () => {
    expect(
      parseDeviceLoginStartResult(
        {
          type: 'chatgptDeviceCode',
          loginId: 'login-123',
          verificationUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-1234',
        },
        1_000,
      ),
    ).toEqual({
      loginId: 'login-123',
      verificationUri: 'https://auth.openai.com/codex/device',
      userCode: 'ABCD-1234',
      expiresAt: 901_000,
    });
  });

  it('applies successful login and account update notifications', () => {
    const initial = {
      authenticated: false,
      pending: true,
      error: null,
      deviceCodeRequired: false,
      planType: null,
    };
    const completed = applyAccountNotification(initial, {
      method: 'account/login/completed',
      params: { loginId: 'login-123', success: true, error: null },
    });
    const updated = applyAccountNotification(completed, {
      method: 'account/updated',
      params: { authMode: 'chatgpt', planType: 'pro' },
    });

    expect(updated).toEqual({
      authenticated: true,
      pending: false,
      error: null,
      deviceCodeRequired: false,
      planType: 'pro',
    });
  });

  it('marks device-code security-setting failures', () => {
    const result = applyAccountNotification(
      {
        authenticated: false,
        pending: true,
        error: null,
        deviceCodeRequired: false,
        planType: null,
      },
      {
        method: 'account/login/completed',
        params: {
          loginId: 'login-123',
          success: false,
          error: 'Enable device code login in ChatGPT Security Settings.',
        },
      },
    );

    expect(result.pending).toBe(false);
    expect(result.deviceCodeRequired).toBe(true);
    expect(isDeviceCodeSettingsError(result.error ?? '')).toBe(true);
  });
});
