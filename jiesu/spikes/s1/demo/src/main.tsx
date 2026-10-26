import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Card } from './Card';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Card />
    </StrictMode>,
  );
}
