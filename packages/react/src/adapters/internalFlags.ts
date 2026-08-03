export interface SmartRteInternalFlags {
  shadowMode?: boolean;
}

type SmartRteGlobal = typeof globalThis & {
  __SMART_RTE_INTERNAL_FLAGS__?: SmartRteInternalFlags;
  __SMART_RTE_SHADOW_MODE__?: boolean;
  process?: { env?: { NODE_ENV?: string } };
};

const getGlobal = () => globalThis as SmartRteGlobal;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const getSmartRteInternalFlags = (): SmartRteInternalFlags =>
  getGlobal().__SMART_RTE_INTERNAL_FLAGS__ || {};

export const isShadowModeFlagEnabled = (): boolean => {
  const configured = readBoolean(getSmartRteInternalFlags().shadowMode);
  if (configured !== undefined) return configured;
  const global = getGlobal();
  if (global.process?.env) return global.process.env.NODE_ENV !== "production";
  return global.__SMART_RTE_SHADOW_MODE__ === true;
};
