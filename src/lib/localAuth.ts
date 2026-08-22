import { supabase } from "@/lib/supabaseClient";

// The actual credential check (password hashing, sessions, password-reset emails) is now owned
// entirely by Supabase Auth. This module keeps a synchronous, locally-cached "who's logged in"
// flag in localStorage — every page in the app gates on isLocalAuthenticated() synchronously in
// a useEffect, and rewriting all of them to await a Supabase session check wasn't worth the churn
// when a tiny cache kept in sync with the real session does the same job.
const SESSION_EMAIL_KEY = "worktrack_local_session_email_v1";

const normalizeEmail = (email: string) => email.toLowerCase().trim();

const emitAuthChange = () => {
  window.dispatchEvent(new Event("local-auth-changed"));
};

export const getCurrentUserEmail = (): string | null => {
  const email = localStorage.getItem(SESSION_EMAIL_KEY);
  return email ? normalizeEmail(email) : null;
};

export const isLocalAuthenticated = (): boolean => !!getCurrentUserEmail();

export const setupLocalAuth = async (email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> => {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password });
  if (error) throw error;
  if (data.session) {
    localStorage.setItem(SESSION_EMAIL_KEY, normalizedEmail);
    emitAuthChange();
    return { needsEmailConfirmation: false };
  }
  // Supabase project has "confirm email" enabled — no session until the user clicks the link.
  return { needsEmailConfirmation: true };
};

export const loginLocalAuth = async (email: string, password: string): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(email);
  const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
  if (error || !data.session) return false;
  localStorage.setItem(SESSION_EMAIL_KEY, normalizedEmail);
  emitAuthChange();
  return true;
};

export const logoutLocalAuth = async () => {
  await supabase.auth.signOut();
  localStorage.removeItem(SESSION_EMAIL_KEY);
  emitAuthChange();
};

/**
 * Call once at app startup. Restores whatever session Supabase already has persisted (page
 * refresh, returning visit) and keeps SESSION_EMAIL_KEY in sync with real auth state from then on
 * — including a session expiring or being revoked elsewhere, which logs this tab out too.
 */
export const initAuthSync = () => {
  supabase.auth.getSession().then(({ data }) => {
    const email = data.session?.user.email;
    if (email) localStorage.setItem(SESSION_EMAIL_KEY, normalizeEmail(email));
    else localStorage.removeItem(SESSION_EMAIL_KEY);
    emitAuthChange();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const email = session?.user.email;
    if (email) localStorage.setItem(SESSION_EMAIL_KEY, normalizeEmail(email));
    else localStorage.removeItem(SESSION_EMAIL_KEY);
    emitAuthChange();
  });
};
