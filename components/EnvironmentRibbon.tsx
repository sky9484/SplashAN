'use client';

import { useState } from 'react';

import styles from './EnvironmentRibbon.module.css';

const STORAGE_KEY = 'splash:sandbox-ribbon-dismissed';

export function EnvironmentRibbon() {
  const [visible, setVisible] = useState(() => (
    typeof window === 'undefined' ? true : sessionStorage.getItem(STORAGE_KEY) !== 'true'
  ));

  if (!visible) return null;

  return (
    <div className={styles.ribbon} role="status">
      <span>Sandbox - Sui testnet - No customer funds</span>
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem(STORAGE_KEY, 'true');
          setVisible(false);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
