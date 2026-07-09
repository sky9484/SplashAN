import { FileLock2, Landmark, ShieldCheck, Vault } from 'lucide-react';

/**
 * The "rent, then own" trust argument. Every row states who holds the
 * license or control TODAY; Splash's own licensing is shown as in-process/
 * planned — never implied as held. The mandatory not-yet-licensed line is
 * rendered by this component so no page can crop it away.
 */
const PARTNER_ROWS = [
  {
    partner: 'Coins.ph',
    role: 'Payout partner of record — BSP-licensed local disbursement in the Philippines',
    status: 'Partner rail',
  },
  {
    partner: 'Hata Global',
    role: 'Labuan-regulated liquidity and FX venue for USD legs',
    status: 'Partner rail',
  },
  {
    partner: 'BitGo',
    role: '2-of-3 key governance for operating assets',
    status: 'Custody governance',
  },
  {
    partner: 'CoKeeps / Gambit',
    role: 'Client-asset custody options as corridor volume grows',
    status: 'Custody options',
  },
];

const LICENSE_PATH = [
  { stage: 'In process', body: 'Labuan FSA — money-broking application under preparation with counsel.' },
  { stage: 'Planned', body: 'BNM Money Services Business (Malaysia) and BSP registration (Philippines), sequenced by corridor demand.' },
];

export default function TrustCompliance() {
  return (
    <div className="trust-body">
      <div className="trust-mandatory" role="note">
        <ShieldCheck aria-hidden="true" />
        <p>
          <strong>Splash is not yet a licensed money-services business.</strong> Today, licensed
          partners are the system of record for regulated activities; Splash operates the software
          and settlement layer between them.
        </p>
      </div>

      <section className="trust-block">
        <h2><Landmark aria-hidden="true" /> Rent the license, then own it</h2>
        <p>
          The honest sequence for a new corridor: run on partners who already hold the licenses,
          prove volume and controls, then bring the licenses in-house. Who does what today:
        </p>
        <div className="trust-table-wrap">
          <table className="trust-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Role of record</th>
                <th>Relationship</th>
              </tr>
            </thead>
            <tbody>
              {PARTNER_ROWS.map((row) => (
                <tr key={row.partner}>
                  <th scope="row">{row.partner}</th>
                  <td>{row.role}</td>
                  <td><span className="trust-chip">{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="trust-block">
        <h2><Vault aria-hidden="true" /> The licensing path</h2>
        <ul className="trust-path">
          {LICENSE_PATH.map((item) => (
            <li key={item.stage}>
              <span className="trust-chip">{item.stage}</span>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="trust-block">
        <h2><FileLock2 aria-hidden="true" /> Audit trail by construction</h2>
        <p>
          Every settlement produces Seal-encrypted evidence stored on Walrus and anchored on Sui.
          Records are private by default; regulators and auditors can be granted visibility on
          authorization — decryption is a permissioned act, not a data request. This aligns with
          Sui&apos;s regulator-visible confidential-transfer direction: confidential to the public,
          verifiable to the people who are supposed to verify.
        </p>
      </section>
    </div>
  );
}
