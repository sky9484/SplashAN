import { ExternalLink, FileSearch } from 'lucide-react';

export type OnchainProofData = {
  packageId: string;
  proofTx1: string;
  proofTx2: string;
};

/**
 * Env-gated on-chain proof panel. The values arrive as props from a server
 * component (app/page.tsx reads SPLASH_PACKAGE_ID / PROOF_TX_1 / PROOF_TX_2)
 * so no digest is ever hardcoded here — check-copy.mjs fails any inline
 * explorer link with a literal digest to force routing through this panel.
 */
export default function OnchainProof({ packageId, proofTx1, proofTx2 }: OnchainProofData) {
  const txs = [proofTx1, proofTx2].filter(Boolean);

  return (
    <div className="iso-proof-panel">
      <div className="iso-proof-head">
        <FileSearch aria-hidden="true" />
        <div>
          <strong>Verify it yourself</strong>
          <small>Testnet contract + example settlements, straight from the explorer</small>
        </div>
      </div>

      {packageId ? (
        <ul className="iso-proof-links">
          <li>
            <span>splash_protocol package</span>
            <span className="iso-proof-actions">
              <a href={`https://suiscan.xyz/testnet/object/${packageId}`} target="_blank" rel="noreferrer">
                Suiscan <ExternalLink aria-hidden="true" />
              </a>
              <a href={`https://testnet.suivision.xyz/object/${packageId}`} target="_blank" rel="noreferrer">
                Suivision <ExternalLink aria-hidden="true" />
              </a>
            </span>
          </li>
          {txs.map((digest, index) => (
            <li key={digest}>
              <span>Example settlement {index + 1}</span>
              <span className="iso-proof-actions">
                <a href={`https://suiscan.xyz/testnet/tx/${digest}`} target="_blank" rel="noreferrer">
                  Suiscan <ExternalLink aria-hidden="true" />
                </a>
                <a href={`https://testnet.suivision.xyz/txblock/${digest}`} target="_blank" rel="noreferrer">
                  Suivision <ExternalLink aria-hidden="true" />
                </a>
              </span>
            </li>
          ))}
          {txs.length === 0 ? (
            <li className="iso-proof-fallback">
              Example settlement links land here after our next verified deploy.
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="iso-proof-fallback">
          Contract published on Sui testnet — verification links land here after our next deploy.
        </p>
      )}
    </div>
  );
}
