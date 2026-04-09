import { getCurrentUserEmail } from "@/lib/localAuth";

export interface WorkHour {
  date: string;
  hours_worked: number;
  start_time: string | null;
  end_time: string | null;
  status?: string | null;
}

export interface UserSettings {
  work_days: Record<string, boolean>;
  hours_per_day: Record<string, number>;
  hourly_rate: number;
}

interface LocalDataShape {
  settings: UserSettings;
  workHours: WorkHour[];
  profile: {
    firstName: string;
  };
}

type LocalUsersData = Record<string, LocalDataShape>;

export interface LocalBackupFile {
  version: 1;
  exported_at: string;
  user_settings: UserSettings;
  work_hours: WorkHour[];
}

const STORAGE_KEY = "worktrack_local_data_by_user_v1";
const LEGACY_STORAGE_KEY = "worktrack_local_data_v1";

const defaultSettings: UserSettings = {
  work_days: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
  },
  hours_per_day: {
    monday: 8,
    tuesday: 8,
    wednesday: 8,
    thursday: 8,
    friday: 8,
    saturday: 0,
    sunday: 0,
  },
  hourly_rate: 0,
};

const defaultData: LocalDataShape = {
  settings: defaultSettings,
  workHours: [],
  profile: {
    firstName: "WorkTrack",
  },
};

const normalizeEmail = (email: string) => email.toLowerCase().trim();

const safeParseUserData = (raw: string | null): LocalDataShape => {
  if (!raw) return defaultData;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalDataShape>;
    return {
      settings: {
        work_days: parsed.settings?.work_days ?? defaultSettings.work_days,
        hours_per_day: parsed.settings?.hours_per_day ?? defaultSettings.hours_per_day,
        hourly_rate:
          typeof parsed.settings?.hourly_rate === "number"
            ? parsed.settings.hourly_rate
            : defaultSettings.hourly_rate,
      },
      workHours: Array.isArray(parsed.workHours) ? parsed.workHours : [],
      profile: {
        firstName: parsed.profile?.firstName || "WorkTrack",
      },
    };
  } catch {
    return defaultData;
  }
};

const safeParseUsers = (raw: string | null): LocalUsersData => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<LocalDataShape>>;
    const entries = Object.entries(parsed).map(([email, value]) => [normalizeEmail(email), safeParseUserData(JSON.stringify(value))]);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
};

const writeUsersData = (data: LocalUsersData) => {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const readUsersData = (): LocalUsersData => {
  if (typeof window === "undefined") return {};
  const users = safeParseUsers(localStorage.getItem(STORAGE_KEY));
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  const currentEmail = getCurrentUserEmail();
  if (legacy && currentEmail) {
    const normalized = normalizeEmail(currentEmail);
    const currentBucket = users[normalized];
    const currentHasHours = (currentBucket?.workHours?.length ?? 0) > 0;
    if (!currentHasHours) {
      users[normalized] = safeParseUserData(legacy);
    }
    writeUsersData(users);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
  return users;
};

const readData = (): LocalDataShape => {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return defaultData;
  const users = readUsersData();
  const normalized = normalizeEmail(currentEmail);
  if (users[normalized]) return users[normalized];

  // Recovery fallback: clone the richest existing bucket so old data remains visible.
  const buckets = Object.values(users);
  const dataBuckets = buckets.filter((bucket) => (bucket.workHours?.length ?? 0) > 0);
  if (dataBuckets.length > 0) {
    const bestBucket = dataBuckets.sort(
      (a, b) => (b.workHours?.length ?? 0) - (a.workHours?.length ?? 0),
    )[0];
    users[normalized] = bestBucket;
    writeUsersData(users);
    return users[normalized];
  }

  return defaultData;
};

const writeData = (data: LocalDataShape) => {
  const currentEmail = getCurrentUserEmail();
  if (!currentEmail) return;
  const users = readUsersData();
  users[normalizeEmail(currentEmail)] = data;
  writeUsersData(users);
};

export const getSettings = (): UserSettings => readData().settings;

export const saveSettings = (settings: UserSettings) => {
  const data = readData();
  writeData({ ...data, settings });
};

export const getProfileFirstName = (): string => readData().profile.firstName || "WorkTrack";

export const setProfileFirstName = (firstName: string) => {
  const data = readData();
  writeData({
    ...data,
    profile: {
      firstName: firstName?.trim() || "WorkTrack",
    },
  });
};

export const getWorkHoursForMonth = (year: number, month: number): WorkHour[] => {
  const data = readData();
  const startDate = new Date(year, month, 1).toISOString().slice(0, 10);
  const endDate = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return data.workHours
    .filter((w) => w.date >= startDate && w.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
};

export const upsertWorkHour = (workHour: WorkHour) => {
  const data = readData();
  const idx = data.workHours.findIndex((w) => w.date === workHour.date);
  if (idx >= 0) {
    data.workHours[idx] = workHour;
  } else {
    data.workHours.push(workHour);
  }
  writeData(data);
};

export const deleteWorkHourByDate = (date: string) => {
  const data = readData();
  data.workHours = data.workHours.filter((w) => w.date !== date);
  writeData(data);
};

export const clearMonthWorkHours = (year: number, month: number) => {
  const data = readData();
  const startDate = new Date(year, month, 1).toISOString().slice(0, 10);
  const endDate = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  data.workHours = data.workHours.filter((w) => w.date < startDate || w.date > endDate);
  writeData(data);
};

export const exportLocalBackup = (): LocalBackupFile => {
  const data = readData();
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    user_settings: data.settings,
    work_hours: data.workHours.sort((a, b) => a.date.localeCompare(b.date)),
  };
};

export const importLocalBackup = (backup: LocalBackupFile) => {
  const data = readData();
  writeData({
    ...data,
    settings: backup.user_settings,
    workHours: backup.work_hours,
  });
};

export const replaceCurrentUserData = (payload: {
  settings: UserSettings;
  workHours: WorkHour[];
  firstName?: string;
}) => {
  const data = readData();
  writeData({
    ...data,
    settings: payload.settings,
    workHours: payload.workHours,
    profile: {
      firstName: payload.firstName?.trim() || data.profile.firstName || "WorkTrack",
    },
  });
};
