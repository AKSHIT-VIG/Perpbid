import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'perpbid — bigger bid, better position',
  description: 'Pay-to-rank leaderboard for perp trading referral codes. Bid USDC on Base to hold #1.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
