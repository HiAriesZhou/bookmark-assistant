import '../globals.css';
import { rootLayoutMetadata } from '@/lib/root-layout-metadata';

export const metadata = rootLayoutMetadata;

export default function ChineseRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
