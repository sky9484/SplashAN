export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === 'production';
}

export function isDemoRuntime(env: NodeJS.ProcessEnv = process.env) {
  return !isProductionRuntime(env)
    || env.USE_MOCK_APIS === 'true'
    || env.NEXT_PUBLIC_DEMO_MODE === 'true';
}

export function canUseDemoCrypto(env: NodeJS.ProcessEnv = process.env) {
  return !isProductionRuntime(env);
}
