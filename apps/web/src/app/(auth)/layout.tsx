export const metadata = {
  title: "Sign in — Contexta",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-secondary px-6">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
}
