import IsometricLanding from "@/components/IsometricLanding";

export default function Home() {
  // Server-side env read: the landing is a client component, so the on-chain
  // proof values travel as props. Empty values render the honest fallback.
  const proof = {
    packageId: (process.env.SPLASH_PACKAGE_ID ?? "").trim(),
    proofTx1: (process.env.PROOF_TX_1 ?? "").trim(),
    proofTx2: (process.env.PROOF_TX_2 ?? "").trim(),
  };

  return <IsometricLanding proof={proof} />;
}
