import { useAuth } from '@clerk/clerk-react';

const isDevMode =
  !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string).startsWith('pk_test_placeholder');

/**
 * Returns a getToken function that works in both Clerk-authed and dev-bypass mode.
 * In dev mode (no real Clerk key) the API accepts requests without a token since
 * the server injects DEV_USER_ID automatically.
 */
export function useAppToken(): { getToken: () => Promise<string | null> } {
  if (isDevMode) {
    return { getToken: async () => null };
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken } = useAuth();
  return { getToken };
}
