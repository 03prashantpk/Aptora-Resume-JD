import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ai" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

export default function Button({ variant = "secondary", className = "", children, ...rest }: Props) {
  return (
    <button className={`ui-btn ${variant} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
