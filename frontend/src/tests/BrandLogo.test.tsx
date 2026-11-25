import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import BrandLogo from '../components/brand/BrandLogo';

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({
    src,
    alt,
    width,
    height,
    priority,
    className,
  }: {
    src: string;
    alt: string;
    width: number;
    height: number;
    priority?: boolean;
    className?: string;
  }) => (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      data-priority={String(Boolean(priority))}
      className={className}
    />
  ),
}));

describe('BrandLogo', () => {
  test('renders horizontal variant by default with lockup dark-mode filters', () => {
    render(<BrandLogo />);

    const img = screen.getByRole('img', { name: 'Contawave' });
    expect(img).toHaveAttribute('src', '/brand/contawave_logo_horizontal.png');
    expect(img).toHaveAttribute('width', '165');
    expect(img).toHaveAttribute('height', '40');
    expect(img).toHaveAttribute('data-priority', 'false');
    expect(img).toHaveClass('dark:brightness-150', 'dark:contrast-105', 'transition-[filter]');
  });

  test('renders icon variant with softer brightness filter and no contrast boost', () => {
    render(<BrandLogo variant="icon" />);

    const img = screen.getByRole('img', { name: 'Contawave' });
    expect(img).toHaveAttribute('src', '/brand/contawave_logo_only.png');
    expect(img).toHaveAttribute('width', '40');
    expect(img).toHaveAttribute('height', '40');
    expect(img).toHaveClass('dark:brightness-125', 'transition-[filter]');
    expect(img).not.toHaveClass('dark:contrast-105');
  });

  test('renders square variant with lockup dark-mode filters', () => {
    render(<BrandLogo variant="square" />);

    const img = screen.getByRole('img', { name: 'Contawave' });
    expect(img).toHaveAttribute('src', '/brand/contawave_logo_square.png');
    expect(img).toHaveAttribute('width', '120');
    expect(img).toHaveAttribute('height', '94');
    expect(img).toHaveClass('dark:brightness-150', 'dark:contrast-105', 'transition-[filter]');
  });

  test('forwards custom alt, className, and priority props', () => {
    const { container } = render(
      <BrandLogo variant="horizontal" alt="ContaWave Logo" className="h-8 w-auto" priority />,
    );

    const img = screen.getByRole('img', { name: 'ContaWave Logo' });
    expect(img).toHaveAttribute('data-priority', 'true');
    expect(container.firstChild).toHaveClass('h-8', 'w-auto');
  });
});
