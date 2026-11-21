export type SlotId =
  | 'voice_tts'
  | 'pronunciation_scoring'
  | 'ielts_stt'
  | 'llm_evaluator'
  | 'llm_generator'
  | 'llm_translation';

export type TierNumber = 1 | 2 | 3;

export type TierLabel = 'Online AI' | 'Basic offline';

export interface ProviderPreset {
  id: string;
  name: string;
  slotId: SlotId;
  tier: TierNumber;
  requiresKey: boolean;
  defaultBaseUrl: string;
  defaultModelOrVoice: string;
  modelSuggestions?: string[];
  modelFieldLabel: string;
  baseUrlPlaceholder: string;
  description: string;
}

export type AuthStyle = 'bearer' | 'custom_header' | 'query_param';

export interface ProviderTestSnapshot {
  ok: boolean;
  latencyMs: number;
  message: string;
  testedAt: number;
  verificationFingerprint?: string;
}

export interface SlotProviderConfig {
  providerId: string;
  baseUrl: string;
  modelOrVoice: string;
  authStyle?: AuthStyle;
  customHeaderName?: string;
  customQueryParamName?: string;
  endpointPathOverride?: string;
  customTtsVoice?: string;
  verified?: boolean;
  testResult?: ProviderTestSnapshot;
}

export interface SlotConfig extends SlotProviderConfig {
  slotId: SlotId;
  secondary?: SlotProviderConfig;
  speechRate?: number;
}

export type AllSlotsConfig = Record<SlotId, SlotConfig>;

export interface SlotDefinition {
  id: SlotId;
  number: number;
  title: string;
  subtitle: string;
  providers: ProviderPreset[];
}

export interface ResolvedSlotTier {
  slotId: SlotId;
  providerId: string;
  providerName: string;
  tier: TierNumber;
  label: TierLabel;
  detailLabel: string;
  isFallback: boolean;
  reason?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  slotId: SlotId;
  providerId: string;
  tier: TierNumber;
  label: TierLabel;
  latencyMs: number;
  message: string;
}
