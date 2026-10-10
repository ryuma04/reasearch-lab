import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** DESIGN.md §8 — capsule buttons with tactile pop-shadow press physics. */
export const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center whitespace-nowrap rounded-full font-semibold transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-purple focus-visible:outline-offset-2",
  {
    variants: {
      variant: {
        primary:
          "bg-pill text-white border-2 border-pill shadow-pop-purple hover:shadow-pop-purple-lg hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        purple:
          "bg-purple text-white border-2 border-ink shadow-pop hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        secondary: "bg-white text-ink shadow-clay-sm hover:-translate-y-0.5 active:scale-[0.97]",
        outline:
          "bg-white text-ink border-2 border-ink shadow-pop hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        soft: "bg-lavender-soft text-purple-deep hover:bg-lavender/60 active:scale-[0.97]",
        danger: "bg-danger text-white hover:brightness-110 active:scale-[0.97]",
        success: "bg-success text-white hover:brightness-110 active:scale-[0.97]",
        ghost: "bg-transparent text-ink hover:bg-ink/5 active:scale-[0.97]",
      },
      size: {
        sm: "h-9 px-3.5 text-[13px] gap-1.5",
        md: "h-11 px-5 text-sm gap-2",
        lg: "h-14 px-7 text-base gap-2.5",
        icon: "h-11 w-11 p-0",
        "icon-sm": "h-9 w-9 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={asChild ? undefined : disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
