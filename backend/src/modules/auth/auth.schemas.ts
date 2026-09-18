import { z } from "zod";

const password = z
  .string()
  .min(8, "A senha deve ter ao menos 8 caracteres.")
  .max(128, "Senha muito longa.");

export const registerSchema = z
  .object({
    name: z.string().trim().min(3, "Informe seu nome completo.").max(120),
    email: z.string().trim().toLowerCase().email("E-mail invalido."),
    phone: z
      .string()
      .trim()
      .min(10, "Telefone invalido.")
      .max(20, "Telefone invalido.")
      .optional()
      .or(z.literal("")),
    password,
    confirmPassword: z.string(),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: "E necessario aceitar os termos para continuar." }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas nao conferem.",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalido."),
  password: z.string().min(1, "Informe sua senha."),
  remember: z.boolean().optional().default(false),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, "Sessao invalida."),
});

export const logoutSchema = z
  .object({
    refreshToken: z.string().min(10).optional(),
  })
  .default({});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  phone: z.string().trim().min(10).max(20).optional().or(z.literal("")),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual."),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "As senhas nao conferem.",
    path: ["confirmPassword"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalido."),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, "Token invalido."),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "As senhas nao conferem.",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
