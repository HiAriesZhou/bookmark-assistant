import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        library: {
          canvas: '#eef0f3',
          paper: '#fcfcfb',
          sidebar: '#f6f6f5',
          ink: '#17191d',
          muted: '#69707d',
          faint: '#9aa1ac',
          line: '#dde1e7',
          strong: '#b9bdc3',
          hover: '#f3f3f1',
          selected: '#eaeae7',
          forest: '#181b21',
          'forest-soft': '#f0f2f5',
          amber: '#d99b3d',
        },
        ui: {
          canvas: '#f6f7f9',
          surface: '#ffffff',
          'surface-subtle': '#fafafa',
          'surface-hover': '#f8f9fa',
          muted: '#fafafa',
          line: '#e8eaed',
          'line-strong': '#d6dae0',
          ink: '#16181d',
          body: '#344054',
          subtle: '#667085',
          disabled: '#98a2b3',
          brand: '#946200',
          'brand-hover': '#765000',
          'brand-soft': '#fff8e7',
          'brand-border': '#eed9a2',
          success: '#15803d',
          'success-soft': '#f2f9f4',
          'success-border': '#bbdfc6',
          warning: '#946200',
          'warning-soft': '#fff8e7',
          'warning-border': '#eed9a2',
          danger: '#b42318',
          'danger-soft': '#fff5f4',
          'danger-border': '#efcbc7',
          control: '#181b21',
          'control-hover': '#292d35',
          'control-disabled': '#eceef1',
          focus: '#74777a',
          selection: '#e5e7eb',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'sync-sweep': {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(320%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'sync-sweep': 'sync-sweep 1.8s ease-in-out infinite',
      },
      boxShadow: {
        'ui-sm': '0 1px 2px rgba(16, 24, 40, 0.03)',
        library: '0 18px 50px rgba(17, 24, 39, 0.1)',
        'library-sm': '0 5px 18px rgba(17, 24, 39, 0.05)',
        'library-popover': '0 8px 28px rgba(23, 25, 28, 0.08), 0 2px 6px rgba(23, 25, 28, 0.04)',
      },
      fontFamily: {
        display: ['Iowan Old Style', 'Noto Serif SC', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
