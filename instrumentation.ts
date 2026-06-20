export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { checkSealHealth } = await import('@/lib/server/seal-health');
  await checkSealHealth({ force: true });
}
