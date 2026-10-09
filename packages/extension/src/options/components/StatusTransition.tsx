import { span as MotionSpan } from 'motion/react-m';
import { useEffect, useRef, type ReactNode } from 'react';

const statusTransition = {
  duration: 0.16,
  ease: [0.2, 0.8, 0.2, 1] as const,
};

export function StatusTransition({
  state,
  children,
  className = '',
}: {
  state: string;
  children: ReactNode;
  className?: string;
}) {
  const hasMounted = useRef(false);

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  return (
    <span className={`inline-grid place-items-center ${className}`}>
      <MotionSpan
        key={state}
        initial={hasMounted.current ? { opacity: 0, scale: 0.94, y: 2 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={statusTransition}
        className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5"
      >
        {children}
      </MotionSpan>
    </span>
  );
}
