import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata = {
  title: '2026 Employee Awards — AppKings',
  description: 'Employee Recognition and Voting Portal for AppKings Solutions.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
