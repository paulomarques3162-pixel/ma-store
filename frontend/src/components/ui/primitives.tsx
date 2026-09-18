import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Icon, type IconName } from "./Icons";

/* ========================================================================== */
/* Botões                                                                      */
/* ========================================================================== */

export type ButtonVariant = "primary" | "accent" | "ghost" | "subtle" | "danger" | "success" | "link";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  /** Ícone opcional à esquerda; quando `iconOnly`, o texto vira aria-label. */
  icon?: IconName;
  iconRight?: IconName;
  iconOnly?: boolean;
};

/**
 * Botão do design system.
 *
 * Quando `loading`, o botão é automaticamente desabilitado — é isso que impede
 * o usuário de disparar a mesma ação duas vezes (regra de prevenção de duplo clique).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block, loading, icon, iconRight, iconOnly, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const classes = [
    "btn",
    `btn--${variant}`,
    size !== "md" ? `btn--${size}` : "",
    block ? "btn--block" : "",
    iconOnly ? "btn--icon" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={iconOnly && typeof children === "string" ? children : rest["aria-label"]}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      {iconOnly ? (typeof children === "string" ? <span className="sr-only">{children}</span> : children) : children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === "sm" ? 16 : 18} /> : null}
    </button>
  );
});

/** Botão apenas com ícone (fechar, favoritar, etc.). */
export function IconButton({
  icon,
  label,
  size = "md",
  className,
  ...rest
}: Omit<ButtonProps, "icon" | "iconOnly" | "children"> & { icon: IconName; label: string }) {
  return (
    <Button icon={icon} iconOnly size={size} className={className} aria-label={label} title={label} {...rest}>
      {label}
    </Button>
  );
}

/* ========================================================================== */
/* Campos de formulário                                                        */
/* ========================================================================== */

type FieldWrapperProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
};

/** Casca de campo: label, dica e mensagem de erro acessíveis. */
export function Field({ label, hint, error, required, children }: FieldWrapperProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      {label ? (
        <label className="field__label" htmlFor={id}>
          {label}
          {required ? <span className="req" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children({ id, describedBy })}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
      {hint && !error ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  label?: string;
  hint?: string;
  error?: string;
  icon?: IconName;
  /** Ação opcional à direita (ex.: mostrar/ocultar senha). */
  action?: { icon: IconName; label: string; onClick: () => void };
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, action, className, required, id: externalId, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <div className="input-group">
          {icon ? (
            <span className="input-group__icon">
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          <input
            ref={ref}
            id={externalId ?? id}
            className={["input", icon ? "input--with-icon" : "", error ? "input--error" : "", className ?? ""].filter(Boolean).join(" ")}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            aria-required={required || undefined}
            required={required}
            {...rest}
          />
          {action ? (
            <button type="button" className="input-group__action" onClick={action.onClick} aria-label={action.label} title={action.label}>
              <Icon name={action.icon} size={18} />
            </button>
          ) : null}
        </div>
      )}
    </Field>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
  error?: string;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, required, id: externalId, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <textarea
          ref={ref}
          id={externalId ?? id}
          className={["textarea", error ? "textarea--error" : "", className ?? ""].filter(Boolean).join(" ")}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          required={required}
          {...rest}
        />
      )}
    </Field>
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, required, id: externalId, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} required={required}>
      {({ id, describedBy }) => (
        <select
          ref={ref}
          id={externalId ?? id}
          className={["select", error ? "select--error" : "", className ?? ""].filter(Boolean).join(" ")}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          required={required}
          {...rest}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
});

export function Checkbox({
  label,
  hint,
  error,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className={["checkbox", className ?? ""].filter(Boolean).join(" ")} htmlFor={id}>
        <input id={id} type="checkbox" aria-invalid={error ? true : undefined} {...rest} />
        <span>{label}</span>
      </label>
      {hint && !error ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="switch" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          role="switch"
          aria-checked={checked}
        />
        <span className="switch__track" aria-hidden="true" />
        <span>{label}</span>
      </label>
      {hint ? <p className="field__hint">{hint}</p> : null}
    </div>
  );
}

/** Campo de busca com ícone e botão de limpar. */
export function SearchInput({
  value,
  onValue,
  onSubmitQuery,
  placeholder = "Buscar produtos",
  autoFocus,
  onBlur,
  inputRef,
  ...rest
}: {
  value: string;
  onValue: (value: string) => void;
  /** Renomeado para nao colidir com o `onSubmit` do DOM. */
  onSubmitQuery?: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "ref">) {
  return (
    <div className="input-group">
      <span className="input-group__icon">
        <Icon name="search" size={18} />
      </span>
      <input
        ref={inputRef}
        type="search"
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onBlur={onBlur}
        onChange={(event) => onValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onSubmitQuery) {
            event.preventDefault();
            onSubmitQuery(value);
          }
        }}
        aria-label={placeholder}
        {...rest}
      />
      {value ? (
        <button type="button" className="input-group__action" onClick={() => onValue("")} aria-label="Limpar busca">
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/** Quantidade com +/- (produto e carrinho). */
export function QuantitySelector({
  value,
  onChange,
  min = 1,
  max,
  disabled,
  label = "Quantidade",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  label?: string;
}) {
  const limit = max !== undefined ? Math.max(0, max) : undefined;
  const canDecrease = !disabled && value > min;
  const canIncrease = !disabled && (limit === undefined || value < limit);

  return (
    <div className="qty-selector" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={!canDecrease} aria-label="Diminuir quantidade">
        <Icon name="minus" size={16} />
      </button>
      <span className="qty-selector__value" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(limit === undefined ? value + 1 : Math.min(limit, value + 1))} disabled={!canIncrease} aria-label="Aumentar quantidade">
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
