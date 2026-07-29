import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "default" | "icon" | "small";
  }
>(function Button(
  { children, variant = "secondary", size = "default", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`button button--${variant} button--${size} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
});
