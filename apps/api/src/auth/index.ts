export {
  createAuth,
  type Auth,
  type AuthDependencies,
} from './auth.js';
export {
  ConsoleEmailSender,
  ResendEmailSender,
  createEmailSender,
  passwordResetEmail,
  verificationEmail,
  type EmailMessage,
  type EmailSender,
  type EmailSenderConfig,
} from './email.js';
