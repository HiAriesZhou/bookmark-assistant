import '../globals.css';
import { rootLayoutMetadata } from '@/lib/root-layout-metadata';

export const metadata = rootLayoutMetadata;

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
