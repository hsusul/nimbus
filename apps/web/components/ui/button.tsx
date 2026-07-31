import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "default" | "icon" | "small";
    /** Disables the control and marks it busy for assistive technology. */
    loading?: boolean;
  }
>(function Button(
  {
    children,
    variant = "secondary",
    size = "default",
    loading = false,
    disabled = false,
    className = "",
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`button button--${variant} button--${size} ${className}`.trim()}
      {...props}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      {children}
    </button>
  );
});
