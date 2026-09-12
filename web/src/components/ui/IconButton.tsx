import type { ButtonHTMLAttributes, ReactNode } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // accessible name (aria-label) + tooltip text
  children: ReactNode;
}

// Small square icon button. `label` is required for accessibility (icon-only).
export default function IconButton({ label, className = "", children, ...rest }: Props) {
  return (
    <button className={`ui-iconbtn ${className}`.trim()} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
