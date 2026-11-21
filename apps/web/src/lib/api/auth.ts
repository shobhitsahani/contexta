import { API_ROUTES } from "@contexta/shared";
import { apiRequest } from "./client";
import type {
  AuthResponse,
  SignupInput,
  LoginInput,
  GoogleLoginInput,
  VerifyEmailInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "@/lib/types";

export const authApi = {
  signup: (data: SignupInput): Promise<AuthResponse> =>
    apiRequest(API_ROUTES.auth.signup, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  login: (data: LoginInput): Promise<AuthResponse> =>
    apiRequest(API_ROUTES.auth.login, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  googleLogin: (data: GoogleLoginInput): Promise<AuthResponse> =>
    apiRequest(API_ROUTES.auth.google, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  verifyEmail: (data: VerifyEmailInput): Promise<AuthResponse> =>
    apiRequest(API_ROUTES.auth.verify, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  forgotPassword: (data: ForgotPasswordInput): Promise<void> =>
    apiRequest(API_ROUTES.auth.forgot, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  resetPassword: (data: ResetPasswordInput): Promise<void> =>
    apiRequest(API_ROUTES.auth.reset, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  logout: (): Promise<void> =>
    apiRequest(API_ROUTES.auth.logout, { method: "POST" }),
};
