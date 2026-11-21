import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Contexta — AI that understands your context",
  description: "An intelligent knowledge assistant that turns your data into answers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Theme applied before React hydrates to prevent a flash of wrong theme */}
        <script
          id="contexta-theme-init"
          dangerouslySetInnerHTML={{
            __html: `
              (function(){
                var key='contexta-theme';
                var stored=null;
                try{stored=localStorage.getItem(key);}catch(e){}
                var theme = (stored==='light'||stored==='dark'||stored==='system')?stored:'system';
                var isDark = theme==='dark' || (theme==='system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                var root=document.documentElement;
                root.setAttribute('data-theme', isDark?'dark':'light');
                if(isDark) root.classList.add('dark'); else root.classList.remove('dark');
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased selection:bg-indigo-200 selection:text-indigo-900 dark:selection:bg-indigo-700 dark:selection:text-white`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
