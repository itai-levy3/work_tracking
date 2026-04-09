interface LocalAuthData {
  email: string;
  passwordHash: string;
  pinHash: string;
}

const AUTH_USERS_KEY = "worktrack_local_auth_users_v1";
const AUTH_LEGACY_KEY = "worktrack_local_auth_v1";
const SESSION_EMAIL_KEY = "worktrack_local_session_email_v1";
const SESSION_LEGACY_KEY = "worktrack_local_session_v1";

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const hashValue = async (value: string) => {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
};

const emitAuthChange = () => {
  window.dispatchEvent(new Event("local-auth-changed"));
};

const normalizeEmail = (email: string) => email.toLowerCase().trim();

const migrateLegacyAuth = () => {
  const usersRaw = localStorage.getItem(AUTH_USERS_KEY);
  if (usersRaw) return;
  const legacyRaw = localStorage.getItem(AUTH_LEGACY_KEY);
  if (!legacyRaw) return;
  try {
    const legacy = JSON.parse(legacyRaw) as LocalAuthData;
    localStorage.setItem(AUTH_USERS_KEY, JSON.stringify([legacy]));
    if (localStorage.getItem(SESSION_LEGACY_KEY) === "1") {
      localStorage.setItem(SESSION_EMAIL_KEY, legacy.email);
    }
    localStorage.removeItem(AUTH_LEGACY_KEY);
    localStorage.removeItem(SESSION_LEGACY_KEY);
  } catch {
    localStorage.removeItem(AUTH_LEGACY_KEY);
  }
};

const getUsers = (): LocalAuthData[] => {
  migrateLegacyAuth();
  try {
    const raw = localStorage.getItem(AUTH_USERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as LocalAuthData[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveUsers = (users: LocalAuthData[]) => {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
};

export const hasLocalAuthAccount = (): boolean => getUsers().length > 0;

export const getCurrentUserEmail = (): string | null => {
  migrateLegacyAuth();
  const email = localStorage.getItem(SESSION_EMAIL_KEY);
  return email ? normalizeEmail(email) : null;
};

export const isLocalAuthenticated = (): boolean => {
  const email = getCurrentUserEmail();
  if (!email) return false;
  return getUsers().some((u) => u.email === email);
};

export const setupLocalAuth = async (email: string, password: string, pin: string) => {
  const normalizedEmail = normalizeEmail(email);
  const users = getUsers();
  if (users.some((u) => u.email === normalizedEmail)) {
    throw new Error("EXISTS");
  }
  const passwordHash = await hashValue(password);
  const pinHash = await hashValue(pin);
  const payload: LocalAuthData = { email: normalizedEmail, passwordHash, pinHash };
  saveUsers([...users, payload]);
  localStorage.setItem(SESSION_EMAIL_KEY, normalizedEmail);
  emitAuthChange();
};

export const loginLocalAuth = async (email: string, password: string): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(email);
  const users = getUsers();
  const data = users.find((u) => u.email === normalizedEmail);
  if (!data) return false;
  const passwordHash = await hashValue(password);
  const ok = data.passwordHash === passwordHash;
  if (ok) {
    localStorage.setItem(SESSION_EMAIL_KEY, normalizedEmail);
    emitAuthChange();
  }
  return ok;
};

export const resetPasswordWithPin = async (
  email: string,
  pin: string,
  newPassword: string,
): Promise<boolean> => {
  const normalizedEmail = normalizeEmail(email);
  const users = getUsers();
  const index = users.findIndex((u) => u.email === normalizedEmail);
  if (index < 0) return false;
  const data = users[index];
  const pinHash = await hashValue(pin);
  const isValid = data.pinHash === pinHash;
  if (!isValid) return false;
  data.passwordHash = await hashValue(newPassword);
  users[index] = data;
  saveUsers(users);
  localStorage.setItem(SESSION_EMAIL_KEY, normalizedEmail);
  emitAuthChange();
  return true;
};

export const updatePasswordLocal = async (
  currentPassword: string,
  newPassword: string,
): Promise<boolean> => {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return false;
  const users = getUsers();
  const index = users.findIndex((u) => u.email === currentEmail);
  if (index < 0) return false;
  const data = users[index];
  const currentHash = await hashValue(currentPassword);
  if (currentHash !== data.passwordHash) return false;
  data.passwordHash = await hashValue(newPassword);
  users[index] = data;
  saveUsers(users);
  emitAuthChange();
  return true;
};

export const logoutLocalAuth = () => {
  localStorage.removeItem(SESSION_EMAIL_KEY);
  emitAuthChange();
};
