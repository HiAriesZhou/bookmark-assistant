type SectionEyebrowProps = {
  text: string;
  color: 'blue' | 'green' | 'amber' | 'purple';
  className?: string;
};

export function SectionEyebrow({ text, color, className = '' }: SectionEyebrowProps) {
  const colorMap = {
    blue: 'to-[#718b72]',
    green: 'to-[#718b72]',
    amber: 'to-[#718b72]',
    purple: 'to-[#718b72]',
  };

  const gradientColor = colorMap[color];

  return (
    <div className={`inline-flex items-center gap-2 mb-4 ${className}`}>
      <div className={`h-px w-8 bg-gradient-to-r from-transparent ${gradientColor}`}></div>
      <span className="text-xs tracking-widest text-gray-500 uppercase">{text}</span>
      <div className={`h-px w-8 bg-gradient-to-l from-transparent ${gradientColor}`}></div>
    </div>
  );
}
