'use client';

import React from 'react';
import Image from 'next/image';
import { cn } from '../../lib/utils';

export interface BrandLogoProps {
  variant?: 'horizontal' | 'icon' | 'square';
  className?: string;
  priority?: boolean;
  alt?: string;
}

type BrandLogoVariant = NonNullable<BrandLogoProps['variant']>;

interface BrandLogoVariantConfig {
  src: string;
  width: number;
  height: number;
  wrapperClass: string;
  imageClass: string;
}

const BRAND_LOGO_VARIANTS: Record<BrandLogoVariant, BrandLogoVariantConfig> = {
  icon: {
    src: '/brand/contawave_logo_only.png',
    width: 40,
    height: 40,
    wrapperClass: 'justify-center',
    imageClass: 'dark:brightness-125',
  },
  square: {
    src: '/brand/contawave_logo_square.png',
    width: 120,
    height: 94,
    wrapperClass: 'justify-center',
    imageClass: 'dark:brightness-150 dark:contrast-105',
  },
  horizontal: {
    src: '/brand/contawave_logo_horizontal.png',
    width: 165,
    height: 40,
    wrapperClass: '',
    imageClass: 'dark:brightness-150 dark:contrast-105',
  },
};

export default function BrandLogo({
  variant = 'horizontal',
  className,
  priority = false,
  alt = 'Contawave',
}: BrandLogoProps) {
  const config = BRAND_LOGO_VARIANTS[variant];

  return (
    <div className={cn('relative flex items-center shrink-0', config.wrapperClass, className)}>
      <Image
        src={config.src}
        alt={alt}
        width={config.width}
        height={config.height}
        priority={priority}
        className={cn('object-contain w-auto h-full transition-[filter]', config.imageClass)}
      />
    </div>
  );
}
