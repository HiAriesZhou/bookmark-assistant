import Image from 'next/image';
import { PRODUCT_NAME, ASSET_PREFIX } from '@/lib/product-links';

type Props = {
  className?: string;
  alt?: string;
  size?: number;
};

export function Logo({ className, alt = PRODUCT_NAME, size = 48 }: Props) {
  return (
    <Image
      src={`${ASSET_PREFIX}/brand/logo.png`}
      alt={alt}
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}
