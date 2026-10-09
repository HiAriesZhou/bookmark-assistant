import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';

import { cn } from '../../lib/utils';

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-[background-color,border-color,box-shadow] duration-200 ease-out',
      'border-ui-line-strong bg-ui-control-disabled data-[state=checked]:border-ui-control data-[state=checked]:bg-ui-control',
      'data-[state=checked]:hover:border-ui-control-hover data-[state=checked]:hover:bg-ui-control-hover data-[state=unchecked]:hover:bg-ui-line-strong',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus focus-visible:ring-offset-2 focus-visible:ring-offset-white',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
    ref={ref}
    type="button"
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(16,24,40,0.24)] ring-0 transition-transform duration-200 ease-out data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-0'
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
