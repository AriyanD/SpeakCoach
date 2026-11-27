import { describe, expect, it } from 'vitest';
import {
  isKnownProviderId,
  PROVIDER_ID_MIGRATIONS,
  resolveMigratedProviderId
} from '../src/storage/providerIdMigration';

describe('provider ID migration registry', () => {
  it('documents the two conditional Groq Whisper migrations', () => {
    expect(PROVIDER_ID_MIGRATIONS.map(({ slotId, from, to }) => ({ slotId, from, to }))).toEqual([
      { slotId: 'pronunciation_scoring', from: 'whisper_alignment', to: 'custom_openai_pronunciation' },
      { slotId: 'ielts_stt', from: 'whisper_stt', to: 'custom_openai_stt' }
    ]);
  });

  it('keeps current IDs intact until the credential-aware migration can inspect their keys', () => {
    expect(resolveMigratedProviderId(
      'ielts_stt',
      'whisper_stt',
      'https://api.groq.com/openai/v1/',
      'whisper-large-v3-turbo'
    )).toBe('whisper_stt');

    expect(resolveMigratedProviderId(
      'ielts_stt',
      'whisper_stt',
      'https://api.openai.com/v1',
      'whisper-1'
    )).toBe('whisper_stt');

    expect(resolveMigratedProviderId(
      'pronunciation_scoring',
      'whisper_alignment',
      'https://api.groq.com/openai/v1',
      'whisper-1'
    )).toBe('whisper_alignment');
  });

  it('leaves unknown future IDs intact for recovery instead of mapping them to offline', () => {
    const unknownId = 'future_provider_v9';
    expect(resolveMigratedProviderId('ielts_stt', unknownId, '', '')).toBe(unknownId);
    expect(isKnownProviderId('ielts_stt', unknownId)).toBe(false);
  });
});
